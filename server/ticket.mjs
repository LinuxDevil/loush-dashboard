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
import path from 'node:path'
import crypto from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { ticketDetail, cfgForTicket, loadProjects, artifactsFor } from './eng.mjs'
import { resolveClone } from '../lib/clone.mjs'
import { spawnAgent } from '../lib/agent.mjs'
import { parseGraph, validateGraph, mergeGraph, layout, applyOps, toMermaid } from '../lib/design-schema.mjs'
import { buildImportGraph, SOURCE_EXTS, IGNORE_DIRS } from './fe.mjs'
import { TICKET_DIR, ticketStateFile } from '../lib/paths.mjs'

const KEY_RE = /^[A-Z][A-Z0-9_]*-\d+$/

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
const runs = new Map() // key -> {key, kind, startedAt, events, listeners, child, done, error, cost, tools, files, cwd, docPath}
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
      if (f) run.files.add(String(f))
      if (c.name === 'Write' && f) run.docPath = String(f)
    }
  }
  if (ev.type === 'result') { run.cost = ev.total_cost_usd ?? run.cost; run.ms = ev.duration_ms ?? run.ms; run.sessionId = ev.session_id || run.sessionId }
  if (ev.type === 'system' && ev.subtype === 'init' && ev.session_id) run.sessionId = ev.session_id
  for (const res of run.listeners) { try { res.write(`data: ${JSON.stringify(ev)}\n\n`) } catch {} }
}

const runView = run => run && ({
  key: run.key, kind: run.kind, startedAt: run.startedAt, done: run.done, error: run.error,
  cancelled: run.cancelled || false, tools: run.tools, filesRead: run.files.size,
  cost: run.cost ?? null, ms: run.ms ?? null, sessionId: run.sessionId || null, docPath: run.docPath || null,
  events: run.events.length,
})

// ---------------------------------------------------------------------------------------------
// prompts
// ---------------------------------------------------------------------------------------------
const promptFile = n => { try { return fs.readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), 'prompts', n), 'utf8') } catch { return '' } }

function designPrompt(d, repo, docRel) {
  return `${promptFile('design-plan.md')}

# The ticket

${d.key} — ${d.summary}
Type: ${d.type} · Status: ${d.status}

## Description
${d.description || '(none)'}

## Comments
${d.comments.map(c => `- ${c.author}: ${c.body}`).join('\n') || '(none)'}

# Your task

You are in the repository \`${repo}\` at \`${process.cwd ? '' : ''}\` — READ IT. Investigate before you
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
    res.json({ ...s, doc, diverged, run: runView(runs.get(r.key)), repo: repoFor(r.cfg) })
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

    let d
    try { d = await ticketDetail(r.cfg, r.key) }
    catch (e) { return res.status(502).json({ error: `could not read ${r.key} from JIRA: ${e.message}` }) }

    const ymd = new Date().toISOString().slice(0, 10)
    const docRel = `docs/superpowers/specs/${ymd}-${r.key.toLowerCase()}-design.md`
    const run = { key: r.key, kind: 'design', startedAt: Date.now(), events: [], listeners: new Set(), done: false, error: null, tools: 0, files: new Set(), cost: null, ms: null, cwd: repo.dir, docPath: null }
    runs.set(r.key, run)

    run.child = spawnAgent({
      cwd: repo.dir,
      prompt: designPrompt(d, repo.repo, docRel),
      model: req.body?.model,
      onEvent: ev => emit(run, ev),
      onExit: ({ error }) => {
        run.done = true
        run.error = run.cancelled ? null : (error || null)
        // Persist what the run produced. The document itself was written by the agent into the repo.
        const abs = path.join(repo.dir, docRel)
        const s = readState(r.key)
        let doc = s.doc
        if (fs.existsSync(abs)) {
          const body = fs.readFileSync(abs, 'utf8')
          doc = { path: abs, rel: docRel, sha: sha(body), genAt: new Date(run.startedAt).toISOString(), model: req.body?.model || 'claude', edited: false, gitignored: isIgnored(repo.dir, docRel) }
        }
        const text = run.events.filter(e => e.type === 'assistant').flatMap(e => (e.message?.content || []).filter(c => c.type === 'text').map(c => c.text)).join('\n')
        const parsed = parseGraph(text)
        const merged = s.graph ? mergeGraph(s.graph, parsed.graph) : { graph: parsed.graph, report: null }
        const graph = layout(merged.graph)
        writeState(r.key, {
          ...s, cwd: repo.dir, doc,
          graph: parsed.graph.nodes.length ? { ...graph, derivedFromDocSha: doc?.sha || null, genAt: new Date().toISOString() } : s.graph,
          warnings: parsed.warnings,
          chat: run.sessionId ? { sessionId: run.sessionId, cwd: repo.dir } : s.chat,
          rev: (s.rev || 0) + 1,
          lastRun: { at: new Date(run.startedAt).toISOString(), cost: run.cost ?? null, ms: run.ms ?? null, tools: run.tools, filesRead: run.files.size, parsedHow: parsed.how, parseError: parsed.error },
          mergeReport: merged.report,
        })
        for (const res2 of run.listeners) { try { res2.end() } catch {} }
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

  // ---- re-extract the graph from the document: the cheap retry ----
  app.post('/api/ticket/:key/design/extract', (req, res) => {
    const r = resolve(req, res); if (!r) return
    const s = readState(r.key)
    const raw = typeof req.body?.raw === 'string' ? req.body.raw : null
    if (!raw) return res.status(400).json({ error: 'raw model output required' })
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
    const { graph, warnings } = validateGraph(req.body?.graph || {})
    // A hand-edited graph is authored, not generated — record that so regeneration will not silently
    // overwrite it (lib/design-schema mergeGraph keys off exactly this).
    for (const n of graph.nodes) {
      const prev = (s.graph?.nodes || []).find(x => x.id === n.id)
      n.position = (req.body?.graph?.nodes || []).find(x => x.id === n.id)?.position ?? prev?.position ?? null
      n.data.origin = (req.body?.graph?.nodes || []).find(x => x.id === n.id)?.data?.origin || 'user'
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
      verified: verified.slice(0, 80), plannedEdit, plannedNew, warnings,
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
