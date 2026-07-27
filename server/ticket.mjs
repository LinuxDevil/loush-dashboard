// server/ticket.mjs — /api/ticket/* — the key-first Ticket section.
//
// PLANE B. This module spawns agents, holds `sessionId`s and accrues cost, all of which are plane-B
// facts. server/eng.mjs (plane A) must never import it; the dependency runs one way only and
// test/server/eng-privacy.test.js asserts that statically.
//
// WHAT THIS ADDS THAT /api/eng/* DID NOT
// Fetching a ticket and generating AC/tests already existed — the gap was reachability. The only UI
// was a drawer reachable by clicking a row on a board that needs full project config plus a snapshot
// the code itself calls "~65s of live JIRA + GitHub". You could not type a key and go. So:
//   * key-first fetch that never blocks on a snapshot (server/eng.mjs `snapWarm`)
//   * a design run with the REAL repository as cwd, resolved from `githubRepo` via lib/clone.mjs
//   * a graph extracted from that document, hand-editable, with regeneration that merges by slug
//   * a files view split verified / planned-edit / planned-new, which never invents a metric
//
// The design DOCUMENT is written into the target repo by the agent itself, so it outlives this app.
// Only the graph, positions and a chat POINTER live here.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { ticketDetail, cfgForTicket, loadProjects, artifactsFor, readArtifacts as readTicketArtifacts } from './eng.mjs'
import { resolveClone } from '../lib/clone.mjs'
import { spawnAgent, runAgent } from '../lib/agent.mjs'
import { parseGraph, parseOps, validateGraph, mergeGraph, layout, applyOps, toMermaid } from '../lib/design-schema.mjs'
import { buildImportGraph, SOURCE_EXTS, IGNORE_DIRS } from './fe.mjs'
import { TICKET_DIR, ticketStateFile } from '../lib/paths.mjs'

const KEY_RE = /^[A-Z][A-Z0-9_]*-\d+$/
const DASH_PORT = Number(process.env.DASH_PORT) || 5178
const BOARD_FILE = path.join(os.homedir(), '.claude', 'taskboard.json')
/** The board ticket this JIRA key was handed off to, if any — read fresh so the stage is live. */
function boardTicket(id) {
  if (!id) return null
  try { return (JSON.parse(fs.readFileSync(BOARD_FILE, 'utf8')).tickets || []).find(t => t.id === id) || null }
  catch { return null }
}

/**
 * Normalize whatever the user pasted into a JIRA key.
 * Accepts a bare key, lowercase, a browse URL, a Slack paste with punctuation, `ABC 1234`,
 * `ABC_1234`. Returns null rather than guessing — a wrong key is a wrong ticket.
 */
export function normalizeKey(input) {
  let s = String(input == null ? '' : input).trim()
  if (!s) return null
  const url = /\/browse\/([A-Za-z][A-Za-z0-9_]*-\d+)/.exec(s) || /[?&]selectedIssue=([A-Za-z][A-Za-z0-9_]*-\d+)/.exec(s)
  if (url) return url[1].toUpperCase()
  s = s.replace(/^[<([]+|[>)\],.;:]+$/g, '').trim()   // Slack/markdown wrapping
  s = s.replace(/[\s_.]+/g, '-').replace(/-+/g, '-')  // "ABC 1234" / "ABC_1234"
  const m = /^([A-Za-z][A-Za-z0-9_]*)-(\d+)$/.exec(s)
  if (!m) return null
  const key = `${m[1].toUpperCase()}-${m[2]}`
  return KEY_RE.test(key) ? key : null
}

// ---------------------------------------------------------------------------------------------
// state — one file per key
// ---------------------------------------------------------------------------------------------
const EMPTY = key => ({ v: 1, key, rev: 0, cwd: null, doc: null, graph: null, chat: null, warnings: [], run: null })

function readState(key) {
  try { return { ...EMPTY(key), ...JSON.parse(fs.readFileSync(ticketStateFile(key), 'utf8')) } }
  catch { return EMPTY(key) }
}
function writeState(key, s) {
  fs.mkdirSync(TICKET_DIR, { recursive: true })
  const tmp = ticketStateFile(key) + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(s, null, 2))
  fs.renameSync(tmp, ticketStateFile(key))   // atomic: a kill mid-write leaves the previous good file
  return s
}
function listKeys() {
  try {
    return fs.readdirSync(TICKET_DIR).filter(f => f.endsWith('.json')).map(f => {
      const key = f.replace(/\.json$/, '')
      let at = 0, nodes = 0
      try { const st = JSON.parse(fs.readFileSync(path.join(TICKET_DIR, f), 'utf8')); at = Date.parse(st.doc?.genAt || 0) || 0; nodes = st.graph?.nodes?.length || 0 } catch {}
      return { key, at, nodes }
    }).sort((a, b) => b.at - a.at)
  } catch { return [] }
}

const sha = s => 'sha256:' + crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 16)

// ---------------------------------------------------------------------------------------------
// repo resolution
// ---------------------------------------------------------------------------------------------
/** Where a design run for this project would execute, and why it can or cannot. */
function repoFor(cfg) {
  if (!cfg?.githubRepo) return { dir: null, how: null, reason: `project ${cfg?.key || '?'} has no githubRepo in projects.json — a design run needs a repository to read` }
  const r = resolveClone(cfg.githubRepo)
  if (!r) return { dir: null, how: null, repo: cfg.githubRepo, reason: `no local checkout resolved for ${cfg.githubRepo} — open it once in Claude Code so it is registered, or clone it locally` }
  return { dir: r.dir, how: r.how, repo: cfg.githubRepo, reason: null }
}

// ---------------------------------------------------------------------------------------------
// design runs — server-owned, keyed by ticket
// ---------------------------------------------------------------------------------------------
// Run state lives HERE, not in the React component: src/App.jsx's refresh() resets `visited` and
// bumps `tick`, which is in the section key, so a refresh click remounts the section and would tear
// down a client-owned EventSource mid-run. Replay-then-live SSE means a remount reattaches.
const runs = new Map() // key -> {key, kind, startedAt, events, listeners, child, done, error, cost, tools, files, cwd, stageRel, docRel, partial}
const KEEP_FINISHED = 8   // a finished run holds its whole event buffer; keep a few for the "what
                          // happened" panel and drop the rest, or a long-lived server accumulates
                          // thousands of events per ticket forever.
function pruneRuns() {
  const finished = [...runs.values()].filter(r => r.done).sort((a, b) => b.startedAt - a.startedAt)
  for (const r of finished.slice(KEEP_FINISHED)) runs.delete(r.key)
}
const MAX_EVENTS = 4000   // a long agentic run is thousands of events; replaying all of them on every
                          // remount is its own performance bug. Keep a bounded tail.
const MAX_CONCURRENT = 2

function emit(run, ev) {
  run.events.push(ev)
  if (run.events.length > MAX_EVENTS) run.events.splice(0, run.events.length - MAX_EVENTS)
  // Roll up the two things that actually reassure a human during a six-minute wait: how many tool
  // calls have happened, and which files were read. "Read 23 files in server/" is the evidence that
  // the agent is genuinely in your repo, which is the whole premise of the feature.
  if (ev.type === 'assistant' && Array.isArray(ev.message?.content)) {
    for (const c of ev.message.content) {
      if (c.type !== 'tool_use') continue
      run.tools++
      const f = c.input?.file_path || c.input?.path
      // Reads only: counting Write/Edit targets here and labelling the total "files read" would
      // overstate the investigation, which is the number the user is judging the run by.
      if (f && !['Write', 'Edit', 'MultiEdit', 'NotebookEdit'].includes(c.name)) run.files.add(String(f))
    }
  }
  if (ev.type === 'result') { run.cost = ev.total_cost_usd ?? run.cost; run.ms = ev.duration_ms ?? run.ms; run.sessionId = ev.session_id || run.sessionId }
  if (ev.type === 'system' && ev.subtype === 'init' && ev.session_id) run.sessionId = ev.session_id
  for (const res of run.listeners) { try { res.write(`data: ${JSON.stringify(ev)}\n\n`) } catch {} }
}

const runView = run => run && ({
  key: run.key, kind: run.kind, startedAt: run.startedAt, done: run.done, error: run.error,
  cancelled: run.cancelled || false, tools: run.tools, filesRead: run.files.size,
  cost: run.cost ?? null, ms: run.ms ?? null, sessionId: run.sessionId || null,
  // A partial document from a cancelled run is surfaced so the user can open or delete it. It is
  // never removed on their behalf.
  partial: run.partial || null, cwd: run.cwd || null,
  events: run.events.length,
})

// ---------------------------------------------------------------------------------------------
// prompts
// ---------------------------------------------------------------------------------------------
// fileURLToPath, NOT `new URL(...).pathname` — pathname is percent-encoded, so any install under a
// directory with a space ("~/My Code/…") resolves to a path that does not exist, and on Windows it
// carries a leading slash ("/C:/…"). The catch would then swallow it and designPrompt() would ship
// a six-minute agent run with NO investigate-first instructions, no file:line requirement and no
// "never invent a path" rule — silently degraded input, confident output, which is the exact shape
// of the bug lib/adf.mjs exists to fix. So it is loaded once at module load and failure is loud.
const PROMPT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'prompts')
function promptFile(n) {
  try { return fs.readFileSync(path.join(PROMPT_DIR, n), 'utf8') }
  catch (e) { console.error(`[ticket] cannot read prompt ${n} from ${PROMPT_DIR}: ${e.message}`); return null }
}

function designPrompt(d, repo, repoDir, docRel) {
  const preamble = promptFile('design-plan.md')
  if (!preamble) throw new Error('the design prompt (server/prompts/design-plan.md) could not be read — refusing to run a degraded design')
  return `${preamble}

# The ticket

${d.key} — ${d.summary}
Type: ${d.type} · Status: ${d.status}

## Description
${d.description || '(none)'}

## Comments
${d.comments.map(c => `- ${c.author}: ${c.body}`).join('\n') || '(none)'}

# Your task

You are in the repository \`${repo}\`, checked out at \`${repoDir}\` — READ IT. Investigate before you
write anything. Then write the design document to \`${docRel}\` using the Write tool.

Finish your reply with the component graph in a single fenced \`\`\`yaml block, in exactly this shape:

nodes:
  - id: short-slug            # semantic, stable across regenerations. NEVER a number.
    label: Human Readable
    type: process             # process|service|store|decision|external|ui|queue
    note: one line of why
    files:
      - rel: path/from/repo/root.mjs
        change: modify        # modify | create
edges:
  - source: slug-a
    target: slug-b
    label: what moves between them
    kind: calls               # calls|reads|writes|publishes|depends|sync|renders
    evidence: why you believe this edge exists

Rules for the graph:
  * Do NOT emit x/y coordinates. Layout is computed, not authored.
  * Every edge needs a label. An unlabelled arrow says nothing.
  * Every file path must be repo-relative and must be one you actually verified, or marked create.
  * Prefer fewer, larger components. More than ~15 nodes is harder to read than a list.`
}

// ---------------------------------------------------------------------------------------------
export default function mountTicket(app) {
  const resolve = (req, res) => {
    const key = normalizeKey(req.params.key)
    if (!key) { res.status(400).json({ error: `"${req.params.key}" is not a JIRA key — expected something like ABC-1234` }); return null }
    const cfg = cfgForTicket(key, req.query.project || req.body?.project)
    if (!cfg) {
      const known = loadProjects().map(p => p.key)
      res.status(404).json({
        error: `no project configured with prefix "${key.split('-')[0]}"`,
        detail: known.length ? `known prefixes: ${known.join(', ')}` : 'no projects are configured yet — add one in Setup',
        available: false,
      })
      return null
    }
    return { key, cfg }
  }

  // ---- the tab's own index: recents + which projects can actually do a design run ----
  app.get('/api/ticket/index', (req, res) => {
    const projects = loadProjects().map(p => {
      const r = repoFor(p)
      return { key: p.key, jiraHost: p.jiraHost || null, githubRepo: p.githubRepo || null, repoDir: r.dir, repoHow: r.how, repoReason: r.reason, writes: p.writes === true }
    })
    res.json({ available: projects.length > 0, projects, recent: listKeys().slice(0, 12), runs: [...runs.values()].filter(r => !r.done).map(runView) })
  })

  // ---- key-first fetch. Never blocks on a snapshot. ----
  app.get('/api/ticket/:key', async (req, res) => {
    const r = resolve(req, res); if (!r) return
    try {
      const d = await ticketDetail(r.cfg, r.key)     // waitForPrs:false, withCommits:false — the fast path
      const repo = repoFor(r.cfg)
      res.json({
        available: true, ...d,
        artifacts: artifactsFor(d),
        project: { key: r.cfg.key, jiraHost: r.cfg.jiraHost, githubRepo: r.cfg.githubRepo, writes: r.cfg.writes === true },
        repo: { dir: repo.dir, how: repo.how, reason: repo.reason },
        url: r.cfg.jiraHost ? `https://${r.cfg.jiraHost}/browse/${r.key}` : null,
      })
    } catch (e) {
      const msg = String(e.message || e)
      // Distinguish the three failures that look identical to a user but need different actions.
      if (/no-jira-creds/.test(msg)) return res.status(400).json({ available: false, reason: 'JIRA credentials are not configured — add an email and API token in Setup' })
      if (/jira 404/.test(msg)) return res.status(404).json({ available: false, reason: `${r.key} was not found on ${r.cfg.jiraHost || 'the configured JIRA host'}` })
      if (/jira 40[13]/.test(msg)) return res.status(403).json({ available: false, reason: `JIRA rejected the request — the token may be expired or lack access to ${r.cfg.key}` })
      res.status(500).json({ available: false, reason: msg })
    }
  })

  // ---- design state ----
  app.get('/api/ticket/:key/design', (req, res) => {
    const r = resolve(req, res); if (!r) return
    const s = readState(r.key)
    let doc = s.doc
    if (doc?.path) {
      // The document lives in the user's repo and can be edited or deleted there. Report what is
      // actually on disk rather than what we last wrote.
      try {
        const body = fs.readFileSync(doc.path, 'utf8')
        doc = { ...doc, exists: true, sha: sha(body), bytes: body.length }
      } catch { doc = { ...doc, exists: false } }
    }
    const diverged = !!(doc?.exists && s.graph && s.graph.derivedFromDocSha && s.graph.derivedFromDocSha !== doc.sha)
    const bt = boardTicket(s.board?.id)
    res.json({
      ...s, doc, diverged, run: runView(runs.get(r.key)), repo: repoFor(r.cfg),
      // Read live, not from our own copy: the whole point of the handoff is that the Ticket tab can
      // show where the work actually got to. A stale cached stage would defeat it.
      board: s.board ? { ...s.board, stage: bt?.stage ?? null, gone: !bt, title: bt?.title ?? null } : null,
      canRetryExtract: !!s.rawText,
    })
  })

  app.get('/api/ticket/:key/design/doc', (req, res) => {
    const r = resolve(req, res); if (!r) return
    const p = readState(r.key).doc?.path
    if (!p) return res.status(404).json({ error: 'no design document has been generated for this ticket' })
    try { res.json({ path: p, md: fs.readFileSync(p, 'utf8') }) }
    catch { res.status(404).json({ error: 'the design document is gone from disk', path: p }) }
  })

  // ---- run the design agent ----
  app.post('/api/ticket/:key/design/run', async (req, res) => {
    const r = resolve(req, res); if (!r) return
    const live = [...runs.values()].filter(x => !x.done)
    if (live.some(x => x.key === r.key)) return res.status(409).json({ error: 'a run is already in flight for this ticket' })
    if (live.length >= MAX_CONCURRENT) return res.status(429).json({ error: `${live.length} design runs are already in flight (${live.map(x => x.key).join(', ')}) — wait, or cancel one` })

    const repo = repoFor(r.cfg)
    if (!repo.dir) return res.status(400).json({ error: repo.reason })
    // §per-repo lock — the global cap alone let two tickets run agents in the SAME working tree.
    // Both would read a tree the other might be mid-write in, and both write into the same specs
    // directory. A repo is a single shared resource; one agent at a time in it.
    const sameRepo = live.find(x => x.cwd === repo.dir)
    if (sameRepo) return res.status(409).json({ error: `${sameRepo.key} is already running a design in ${repo.repo} — one agent per repository at a time` })

    let d
    try { d = await ticketDetail(r.cfg, r.key) }
    catch (e) { return res.status(502).json({ error: `could not read ${r.key} from JIRA: ${e.message}` }) }

    const ymd = new Date().toISOString().slice(0, 10)
    const docRel = `docs/superpowers/specs/${ymd}-${r.key.toLowerCase()}-design.md`
    // §cancel-safe writes — the agent writes to a STAGING path and the server moves it into place
    // only on a clean exit. `child.kill()` can land between two Write calls, and the previous
    // behaviour let that leave a half-written design document at the real path, in the user's git
    // repo, indistinguishable from a finished one. Now a cancelled or crashed run leaves only the
    // staging file, which is reported as partial and never silently deleted.
    const stageRel = `docs/superpowers/specs/.${r.key.toLowerCase()}-design.inprogress.md`
    // Re-check AFTER the await: the in-flight test above happens before `ticketDetail`, which on a
    // cold cache is a real JIRA round trip. Two clicks in that window both passed the check and
    // both spawned an agent into the same working tree, and the second runs.set orphaned the first
    // — still running, uncancellable, still writing the same file.
    if ([...runs.values()].some(x => x.key === r.key && !x.done)) return res.status(409).json({ error: 'a run is already in flight for this ticket' })

    const run = { key: r.key, kind: 'design', startedAt: Date.now(), events: [], listeners: new Set(), done: false, error: null, tools: 0, files: new Set(), cost: null, ms: null, cwd: repo.dir, model: req.body?.model || null, partial: null }
    runs.set(r.key, run)

    let prompt
    try { prompt = designPrompt(d, repo.repo, repo.dir, stageRel) }
    catch (e) { runs.delete(r.key); return res.status(500).json({ error: e.message }) }
    run.stageRel = stageRel
    run.docRel = docRel

    run.child = spawnAgent({
      cwd: repo.dir,
      prompt,
      model: req.body?.model,
      onEvent: ev => emit(run, ev),
      onExit: ({ error }) => {
        run.done = true
        run.error = run.cancelled ? null : (error || null)
        // Everything below writes state and closes listeners. If any of it throws, the listeners
        // would hang open forever waiting for an end that never comes — so it is all guarded and
        // the close happens in `finally`.
        try {
        // Promote the staging file to the real path ONLY on a clean exit. A cancelled or failed run
        // leaves the staging file where it is: reported, offered, never deleted — deleting the
        // user's partial work would be worse than leaving it, and moving it into place would be
        // worse still, because a half-written spec at the real path is indistinguishable from a
        // finished one.
        const stageAbs = path.join(repo.dir, run.stageRel)
        const abs = path.join(repo.dir, run.docRel)
        const clean = !run.cancelled && !error
        let partial = null
        if (fs.existsSync(stageAbs)) {
          if (clean) { try { fs.mkdirSync(path.dirname(abs), { recursive: true }); fs.renameSync(stageAbs, abs) } catch (e) { run.error = `wrote ${run.stageRel} but could not move it into place: ${e.message}` } }
          else partial = { rel: run.stageRel, path: stageAbs, bytes: (() => { try { return fs.statSync(stageAbs).size } catch { return 0 } })() }
        }
        const s = readState(r.key)
        let doc = s.doc
        if (fs.existsSync(abs) && clean) {
          const body = fs.readFileSync(abs, 'utf8')
          doc = { path: abs, rel: run.docRel, sha: sha(body), genAt: new Date(run.startedAt).toISOString(), model: run.model || 'claude', edited: false, gitignored: isIgnored(repo.dir, run.docRel) }
        }
        run.partial = partial
        const text = run.events.filter(e => e.type === 'assistant').flatMap(e => (e.message?.content || []).filter(c => c.type === 'text').map(c => c.text)).join('\n')
        const parsed = parseGraph(text)
        const rawText = text.slice(-40_000)   // kept so a failed extraction can be retried without re-running the agent

        // §approval gate — a REGENERATION over an existing graph is never applied silently.
        // design.md §4.1: "graph is not replaced; banner + three-way preview, user approves". The
        // previous behaviour merged and wrote in one step, so a user-authored label or node could
        // be reconciled away by a background run with no chance to look at it first. A FIRST
        // generation has nothing to destroy, so it applies directly.
        const isFirst = !s.graph?.nodes?.length
        const next = { ...s, cwd: repo.dir, doc, warnings: parsed.warnings, rawText,
          chat: run.sessionId ? { sessionId: run.sessionId, cwd: repo.dir } : s.chat,
          rev: (s.rev || 0) + 1,
          lastRun: { at: new Date(run.startedAt).toISOString(), cost: run.cost ?? null, ms: run.ms ?? null, tools: run.tools, filesRead: run.files.size, parsedHow: parsed.how, parseError: parsed.error },
        }
        if (parsed.graph.nodes.length && isFirst) {
          next.graph = { ...layout(parsed.graph), derivedFromDocSha: doc?.sha || null, genAt: new Date().toISOString() }
          next.pending = null
        } else if (parsed.graph.nodes.length) {
          const merged = mergeGraph(s.graph, parsed.graph)
          next.pending = {
            graph: { ...layout(merged.graph), derivedFromDocSha: doc?.sha || null, genAt: new Date().toISOString() },
            report: merged.report,
            at: new Date().toISOString(),
          }
        }
        writeState(r.key, next)
        } catch (e) {
          run.error = run.error || `the run finished but its result could not be saved: ${e.message}`
        } finally {
          for (const res2 of run.listeners) { try { res2.end() } catch {} }
          run.listeners.clear()
          pruneRuns()
        }
      },
    })
    res.json({ ok: true, run: runView(run), docRel })
  })

  // ---- SSE: replay then live, so a remount reattaches mid-run ----
  app.get('/api/ticket/:key/design/events', (req, res) => {
    const key = normalizeKey(req.params.key)
    const run = key && runs.get(key)
    if (!run) return res.status(404).json({ error: 'no run for this ticket' })
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
    res.write(': connected\n\n')
    for (const ev of run.events) res.write(`data: ${JSON.stringify(ev)}\n\n`)
    if (run.done) return res.end()
    run.listeners.add(res)
    req.on('close', () => run.listeners.delete(res))
  })

  app.post('/api/ticket/:key/design/cancel', (req, res) => {
    const key = normalizeKey(req.params.key)
    const run = key && runs.get(key)
    if (!run || run.done) return res.status(404).json({ error: 'no run in flight for this ticket' })
    run.cancelled = true            // cancellation is a STATE, not an error
    run.child?.kill()
    res.json({ ok: true })
  })

  // ---- apply or discard a pending re-derive ----
  // The preview is the point: a regeneration reconciles against hand edits, and the user has to be
  // able to see kept/added/dropped and keep their own nodes before it lands.
  app.post('/api/ticket/:key/design/rederive', (req, res) => {
    const r = resolve(req, res); if (!r) return
    const s = readState(r.key)
    if (!s.pending) return res.status(404).json({ error: 'nothing pending' })
    if (req.body?.action === 'discard') return res.json(writeState(r.key, { ...s, pending: null, rev: s.rev + 1 }))

    // `keep` names nodes the user chose to rescue from the dropped list. A node the model omitted
    // is not thereby proven wrong, and silently discarding hand-work to a background regeneration
    // is the fastest way to make someone stop editing.
    const keep = new Set(Array.isArray(req.body?.keep) ? req.body.keep : [])
    const graph = { ...s.pending.graph, nodes: [...s.pending.graph.nodes] }
    const have = new Set(graph.nodes.map(n => n.id))
    for (const id of keep) {
      const old = (s.graph?.nodes || []).find(n => n.id === id)
      if (old && !have.has(id)) { graph.nodes.push({ ...old, data: { ...old.data, orphaned: true } }); have.add(id) }
    }
    for (const e of s.graph?.edges || []) {
      if (have.has(e.source) && have.has(e.target) && !graph.edges.some(x => x.id === e.id)) graph.edges.push(e)
    }
    res.json(writeState(r.key, { ...s, graph: layout(graph), pending: null, rev: s.rev + 1 }))
  })

  // ---- hand the ticket to the Task Board pipeline ----
  // This is the answer to "doesn't this duplicate the Task Board?": it does not, because this tab
  // PLANS and the board EXECUTES, and this route is the seam. It carries jiraKey and the design doc
  // path so the link works in both directions rather than being a one-way paste into `desc`.
  app.post('/api/ticket/:key/board', async (req, res) => {
    const r = resolve(req, res); if (!r) return
    const repo = repoFor(r.cfg)
    if (!repo.dir) return res.status(400).json({ error: repo.reason })
    const s = readState(r.key)
    let d
    try { d = await ticketDetail(r.cfg, r.key) }
    catch (e) { return res.status(502).json({ error: `could not read ${r.key} from JIRA: ${e.message}` }) }

    const art = readTicketArtifacts()[r.key] || {}
    const parts = [
      `JIRA: ${r.cfg.jiraHost ? `https://${r.cfg.jiraHost}/browse/${r.key}` : r.key}`,
      '', d.description || '(no description)',
    ]
    if (art.ac?.md) parts.push('', '## Acceptance criteria', art.ac.md)
    if (s.doc?.rel) parts.push('', `## Design`, `See \`${s.doc.rel}\` in this repository.`)

    try {
      // Self-fetch rather than writing taskboard.json directly: the create route resolves the
      // project's pipeline and stamps the pipeline version, and duplicating that here would drift.
      // Same pattern as server/index.mjs:2633 and :3772.
      const r2 = await fetch(`http://127.0.0.1:${DASH_PORT}/api/board/tickets`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ project: repo.dir, title: `${r.key} — ${d.summary}`, desc: parts.join('\n'), jiraKey: r.key, designDoc: s.doc?.rel || null, type: 'feature' }),
      })
      if (!r2.ok) throw new Error(`board ${r2.status}: ${(await r2.text()).slice(0, 200)}`)
      const t = await r2.json()
      writeState(r.key, { ...s, board: { id: t.id, at: new Date().toISOString(), project: repo.dir } })
      res.json({ ok: true, id: t.id, stage: t.stage })
    } catch (e) { res.status(500).json({ error: e.message }) }
  })

  // ---- discard the partial document a cancelled run left behind ----
  // Deleting it is the USER's call, never the server's, and the path is derived here rather than
  // accepted from the request so this cannot become an arbitrary-delete endpoint.
  app.delete('/api/ticket/:key/design/partial', (req, res) => {
    const r = resolve(req, res); if (!r) return
    const run = runs.get(r.key)
    if (!run?.partial) return res.status(404).json({ error: 'no partial document for this ticket' })
    try { fs.unlinkSync(run.partial.path); run.partial = null; res.json({ ok: true }) }
    catch (e) { res.status(500).json({ error: e.message }) }
  })

  // ---- re-extract the graph from the document: the cheap retry ----
  app.post('/api/ticket/:key/design/extract', (req, res) => {
    const r = resolve(req, res); if (!r) return
    const s = readState(r.key)
    // Falls back to the run's own stored output, so the retry button works without the client
    // having to keep megabytes of model text it never sees. Without this the endpoint was
    // uncallable — which is why design.md's "retry button" never existed.
    const raw = typeof req.body?.raw === 'string' ? req.body.raw : s.rawText
    if (!raw) return res.status(400).json({ error: 'no stored model output to re-extract from — run a design first' })
    const parsed = parseGraph(raw)
    if (!parsed.graph.nodes.length) return res.status(422).json({ error: parsed.error || 'no graph could be extracted', warnings: parsed.warnings })
    const merged = s.graph ? mergeGraph(s.graph, parsed.graph) : { graph: parsed.graph, report: null }
    const out = writeState(r.key, { ...s, graph: { ...layout(merged.graph), derivedFromDocSha: s.doc?.sha || null, genAt: new Date().toISOString() }, warnings: parsed.warnings, rev: (s.rev || 0) + 1, mergeReport: merged.report })
    res.json(out)
  })

  // ---- structural edit, guarded by rev ----
  app.put('/api/ticket/:key/design/graph', (req, res) => {
    const r = resolve(req, res); if (!r) return
    const s = readState(r.key)
    const want = Number(req.get('if-match') ?? req.body?.rev)
    if (Number.isFinite(want) && want !== s.rev) return res.status(409).json({ error: 'this design changed elsewhere', rev: s.rev, yours: want, graph: s.graph })
    // trustPositions: this is a HAND edit, so the coordinates in it are the user's, not a model's.
    const { graph, warnings } = validateGraph(req.body?.graph || {}, { trustPositions: true })
    const sent = new Map((req.body?.graph?.nodes || []).map(n => [n.id, n]))
    const prevById = new Map((s.graph?.nodes || []).map(n => [n.id, n]))
    for (const n of graph.nodes) {
      n.position = n.position ?? prevById.get(n.id)?.position ?? null
      // Preserve the origin the client reports; only genuinely new nodes become 'user'. Marking
      // every node in a PUT as user-authored would make the next regeneration refuse to update any
      // of them, quietly freezing the diagram.
      n.data.origin = sent.get(n.id)?.data?.origin || prevById.get(n.id)?.data?.origin || 'user'
    }
    res.json(writeState(r.key, { ...s, graph: { ...layout(graph), derivedFromDocSha: s.graph?.derivedFromDocSha ?? null }, warnings, rev: s.rev + 1 }))
  })

  // ---- positions only. No precondition: last-write-wins is correct for coordinates. ----
  app.patch('/api/ticket/:key/design/layout', (req, res) => {
    const r = resolve(req, res); if (!r) return
    const s = readState(r.key)
    if (!s.graph) return res.status(404).json({ error: 'no graph yet' })
    const pos = req.body?.positions || {}
    const nodes = s.graph.nodes.map(n => (pos[n.id] && Number.isFinite(pos[n.id].x) && Number.isFinite(pos[n.id].y) ? { ...n, position: { x: Math.round(pos[n.id].x), y: Math.round(pos[n.id].y) } } : n))
    writeState(r.key, { ...s, graph: { ...s.graph, nodes } })   // rev deliberately unchanged
    res.json({ ok: true, rev: s.rev })
  })

  // ---- ops proposed by chat, applied by the user ----
  app.post('/api/ticket/:key/design/ops', (req, res) => {
    const r = resolve(req, res); if (!r) return
    const s = readState(r.key)
    if (!s.graph) return res.status(404).json({ error: 'no graph yet' })
    const want = Number(req.get('if-match') ?? req.body?.rev)
    if (Number.isFinite(want) && want !== s.rev) return res.status(409).json({ error: 'this design changed elsewhere', rev: s.rev, yours: want })
    const { graph, results } = applyOps(s.graph, req.body?.ops)
    if (!results.some(x => x.ok)) return res.status(422).json({ error: 'no op could be applied', results })
    const out = writeState(r.key, { ...s, graph: { ...layout(graph), derivedFromDocSha: s.graph.derivedFromDocSha ?? null }, rev: s.rev + 1 })
    res.json({ ...out, results })
  })

  // ---- design chat: the assistant PROPOSES ops, the user applies them ----
  // It never writes the graph. That is a product invariant, not a permission setting — an
  // assistant with write access to the artifact turns every hallucination into a silent edit.
  // Resumes the design run's own session so a turn costs a question, not the whole plan again.
  app.post('/api/ticket/:key/design/chat', async (req, res) => {
    const r = resolve(req, res); if (!r) return
    const s = readState(r.key)
    if (!s.graph) return res.status(404).json({ error: 'no design graph yet — run a design first' })
    const question = String(req.body?.text || '').trim()
    if (!question) return res.status(400).json({ error: 'text required' })
    const cwd = s.chat?.cwd || s.cwd || repoFor(r.cfg).dir
    if (!cwd) return res.status(400).json({ error: repoFor(r.cfg).reason })

    const focus = (req.body?.nodeIds || []).map(id => s.graph.nodes.find(n => n.id === id)).filter(Boolean)
    const shape = s.graph.nodes.map(n => `  - id: ${n.id}\n    label: ${n.data.label}\n    type: ${n.type}${n.data.files?.length ? `\n    files: ${n.data.files.map(f => f.rel).join(', ')}` : ''}`).join('\n')
    const edges = s.graph.edges.map(e => `  - ${e.source} -> ${e.target}: ${e.label || '(unlabelled)'}`).join('\n')

    const prompt = `You are helping refine a system-design diagram for ${r.key}. The current diagram is:

nodes:
${shape}
edges:
${edges}
${focus.length ? `\nThe user is asking about: ${focus.map(n => `"${n.data.label}" (${n.id})`).join(', ')}` : ''}

Their question: ${question}

Answer in at most a short paragraph. THEN, only if the answer implies concrete changes to the
diagram, append a single fenced \`\`\`yaml block with an op list:

ops:
  - op: add-node        # add-node | remove-node | rename-node | set-note | add-edge | remove-edge
    id: some-slug
    label: Human Readable
    type: process
  - op: add-edge
    source: some-slug
    target: other-slug
    label: what moves
    kind: calls

Rules: ids are the semantic slugs above, never numbers. Never emit coordinates. Propose the
smallest set of ops that answers the question — if none are needed, omit the block entirely and
say so. You are proposing; the user decides what to apply.`

    const out = await runAgent({ cwd, prompt, resume: s.chat?.sessionId, timeoutMs: 300_000 })
    if (out.error) return res.status(502).json({ error: out.error })
    const ops = parseOps(out.result)
    // Persist only the session POINTER. The CLI already keeps the transcript on disk and
    // historyEvents() reads it back; a second copy here would grow without bound and would put a
    // plane-B artifact into a store the Ticket tab hands around.
    if (out.sessionId) writeState(r.key, { ...readState(r.key), chat: { sessionId: out.sessionId, cwd } })
    res.json({ text: out.result, ops, cost: out.cost ?? null, sessionId: out.sessionId || null })
  })

  app.get('/api/ticket/:key/design/mermaid', (req, res) => {
    const r = resolve(req, res); if (!r) return
    const s = readState(r.key)
    if (!s.graph) return res.status(404).json({ error: 'no graph yet' })
    res.type('text/plain').send(toMermaid(s.graph))
  })

  app.delete('/api/ticket/:key/design', (req, res) => {
    const r = resolve(req, res); if (!r) return
    try { fs.unlinkSync(ticketStateFile(r.key)) } catch {}
    res.json({ ok: true })
  })

  // ---- files: verified / planned-edit / planned-new ----
  // The three tiers are the deliverable. A file the plan says it will CREATE that already exists is
  // reclassified as an edit (with a warning) rather than shown in a tier that promises no metrics.
  app.get('/api/ticket/:key/files', (req, res) => {
    const r = resolve(req, res); if (!r) return
    const s = readState(r.key)
    const repo = repoFor(r.cfg)
    if (!s.graph) return res.json({ available: false, reason: 'no design graph yet — run a design first' })
    if (!repo.dir) return res.json({ available: false, reason: repo.reason })

    const planned = new Map()
    for (const n of s.graph.nodes) for (const f of n.data?.files || []) {
      const cur = planned.get(f.rel) || { rel: f.rel, change: f.change, nodes: [] }
      cur.nodes.push({ id: n.id, label: n.data.label })
      if (f.change === 'modify') cur.change = 'modify'
      planned.set(f.rel, cur)
    }

    let idx
    try { idx = indexRepo(repo.dir) } catch (e) { return res.json({ available: false, reason: `could not read ${repo.dir}: ${e.message}` }) }
    const importersOf = rel => [...(idx.importers.get(rel) || [])]

    const verified = [], plannedEdit = [], plannedNew = [], warnings = []
    for (const p of planned.values()) {
      const exists = idx.fileSet.has(p.rel)
      if (!exists) {
        if (p.change === 'modify') warnings.push({ code: 'missing-file', detail: `the design says it will modify ${p.rel}, which does not exist` })
        // importers is NULL, never 0 — there is no source to parse, so there is nothing measured.
        plannedNew.push({ ...p, exists: false, importers: null, importedBy: null })
        continue
      }
      if (p.change === 'create') warnings.push({ code: 'exists-already', detail: `the design says it will create ${p.rel}, which already exists — shown as an edit` })
      const imp = importersOf(p.rel)
      plannedEdit.push({ ...p, exists: true, change: 'modify', importers: imp.length, importedBy: imp.slice(0, 25) })
    }
    // Everything the plan's files import that the plan did not itself name: real, parsed, verified.
    const named = new Set(planned.keys())
    for (const p of plannedEdit) for (const dep of idx.imports.get(p.rel) || []) {
      if (named.has(dep) || verified.some(v => v.rel === dep)) continue
      const imp = importersOf(dep)
      verified.push({ rel: dep, exists: true, importers: imp.length, importedBy: imp.slice(0, 25), viaNodes: p.nodes })
    }

    res.json({
      available: true, repo: { dir: repo.dir, how: repo.how },
      // `verifiedTotal` before the slice: rendering `verified.length` after capping presents 80 as
      // a fact when the real number is 214. Silent truncation shown as a total is the same class of
      // error this whole tab is built to avoid.
      verified: verified.slice(0, 80), verifiedTotal: verified.length,
      plannedEdit, plannedNew, warnings,
      stats: { walked: idx.fileSet.size, truncated: idx.truncated },
      // Stated in the payload, not just the UI: there is no source to parse between two files that
      // do not exist, so no edge between them is drawn anywhere.
      note: 'no data-flow edges are drawn between planned-new files — there is no source to parse',
    })
  })
}

// ---------------------------------------------------------------------------------------------
const WALK_CAP = 5000
/** Walk the repo once and build a real import graph over the files that actually exist. */
function indexRepo(root) {
  const files = []
  let truncated = false
  const walk = dir => {
    if (files.length >= WALK_CAP) { truncated = true; return }
    let ents = []
    try { ents = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of ents) {
      if (files.length >= WALK_CAP) { truncated = true; return }
      if (e.name.startsWith('.') || IGNORE_DIRS.has(e.name)) continue
      const abs = path.join(dir, e.name)
      if (e.isDirectory()) walk(abs)
      else if (SOURCE_EXTS.has(path.extname(e.name))) files.push(path.relative(root, abs).split(path.sep).join('/'))
    }
  }
  walk(root)
  const fileSet = new Set(files)
  const sources = new Map()
  for (const rel of files) { try { sources.set(rel, fs.readFileSync(path.join(root, rel), 'utf8')) } catch {} }
  // buildImportGraph already returns both directions plus resolve statistics — reuse them rather
  // than re-deriving, so the numbers this tab shows are the same ones the Working Set shows.
  const { importers, imports, stats } = buildImportGraph(sources, fileSet)
  return { fileSet, importers, imports, stats, truncated }
}

/** Is this path gitignored in the target repo? Reported to the user; never acted on. */
function isIgnored(root, rel) {
  try { return spawnSync('git', ['-C', root, 'check-ignore', '-q', rel], { timeout: 3000 }).status === 0 }
  catch { return false }
}
