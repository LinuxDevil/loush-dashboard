// Deep Research — multi-step web research with source reading and report generation.
//
// This file is AGPL-3.0. Portions are derived from Odysseus
// (https://github.com/odysseus-dev/odysseus), Copyright (c) the Odysseus contributors, licensed
// under AGPL-3.0 — see NOTICE, clause 1. Specifically: the report requirements in
// `researchPrompt` are adapted from `src/deep_research.py` (FINAL_REPORT_PROMPT and
// current_date_context), and the run lifecycle — start / status / stream / cancel / report /
// library / delete keyed on a validated session id — follows `routes/research/research_routes.py`.
//
// Modified 2026-07-31 (AGPL §5(a)): rewritten for Node/Express, and deliberately NOT a port of the
// orchestration. Odysseus runs its own planner, query generator, per-round synthesiser and
// LLM stop-check. The `claude` CLI already is a multi-step research orchestrator with WebSearch and
// WebFetch, so re-implementing those loops here would be a second planner fighting the first. What
// remains is a lifecycle and streaming layer around ONE agent run.
//
// ponytail: skipped deliberately — the per-step planner UI, image extraction, thumbnails, and
// endpoint resolution. Also Odysseus's own planner, query generator, per-round synthesiser and LLM
// stop-check, for the reason above: a second orchestrator would fight the CLI's. And ownership/auth,
// which has no meaning in a single-user local tool.
//
// Run state lives HERE, in server memory keyed by id, and the report lives on disk. src/App.jsx
// remounts sections on every refresh — see the note on `spawnAgent` in lib/agent.mjs — so a
// client-owned run would die the first time the user clicked anything.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { spawnAgent } from '../lib/agent.mjs'
import { createRun, emit, replayFrom } from '../lib/chat-protocol.mjs'

const RESEARCH_DIR = path.join(process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude'), 'dashboard-research')

// The id becomes a directory name. Validated against a fixed alphabet BEFORE it touches a path,
// rather than sanitised: sanitising invents a different id and then operates on it, which turns a
// traversal attempt into a silent read of the wrong run.
const ID_RE = /^[a-z0-9]{6,12}$/
export const validId = id => typeof id === 'string' && ID_RE.test(id)

/** Absolute paths for a run, or null if the id is not one we would ever have minted. */
export function runPaths(id) {
  if (!validId(id)) return null
  const dir = path.join(RESEARCH_DIR, id)
  return { dir, report: path.join(dir, 'report.md'), meta: path.join(dir, 'meta.json') }
}

const newId = () => randomBytes(5).toString('hex')   // 10 chars of [0-9a-f]; inside ID_RE by construction
const MAX_LIVE = 3
const MAX_QUESTION = 2000
const REPORT_CAP = 2 * 1024 * 1024
const KILL_GRACE_MS = 5000   // how long a cancelled child gets to honour SIGTERM before SIGKILL
const KEEP_FINISHED = 20     // finished runs kept addressable for reconnects; the archive is on disk

const runs = new Map()

/**
 * Prompt for one research run.
 *
 * The citation requirement is the load-bearing part. A research report whose claims cannot be
 * traced back to a URL is worse than no report: it reads authoritative and cannot be checked.
 */
function researchPrompt(question, reportPath) {
  const now = new Date()
  const year = now.getFullYear()
  return `Today's date is ${now.toISOString().slice(0, 10)}. When a search query needs a year, or the question says "latest" or "current", use ${year} or relative wording — never a year inferred from your training data.

You are a research agent with WebSearch and WebFetch. Answer this question by researching the live web:

${question}

How to work:
1. Break the question into 3-6 sub-questions before you search, and say what they are.
2. WebSearch to find candidate sources, then WebFetch to actually READ the pages you intend to cite. Never cite a page you only saw as a search result — the snippet is not the source.
3. Keep going until the sub-questions are answered or further searching stops adding anything new. Prefer primary sources. Note where sources disagree with each other.

Then write the finished report to this exact path with the Write tool: ${reportPath}

Report requirements:
- Markdown. Open with a short executive summary paragraph, then \`##\` sections and \`###\` subsections.
- EVERY factual claim carries an inline citation as a markdown link to the URL it came from: [what it says](https://example.com/page). This is not optional. If you cannot cite a claim, either mark it explicitly as unsourced inference or leave it out.
- Give specific numbers, dates and quantities from the sources, each with its citation beside it.
- State plainly where sources conflict and where the evidence is thin.
- End with a \`## Sources\` section listing every URL you actually read, each with one line on what it contributed.
- At least 800 words, unless the question is genuinely narrow enough that padding would hurt it.

Write the file — that is the deliverable. In your reply, do not paste the report; give two or three sentences on what you found and how many sources you read.`
}

const readMeta = file => { try { return JSON.parse(fs.readFileSync(file, 'utf8')) } catch { return null } }

function writeMeta(r) {
  const p = runPaths(r.id)
  if (!p) return
  try {
    fs.mkdirSync(p.dir, { recursive: true })
    fs.writeFileSync(p.meta, JSON.stringify({
      id: r.id, question: r.question, cwd: r.cwd, at: r.at, status: r.status,
      error: r.error, reportBytes: r.reportBytes, ms: r.ms, cost: r.cost,
    }, null, 2))
  } catch {}
}

/**
 * The report, never reading more than `cap` bytes of it into memory.
 *
 * readFileSync-then-slice bounded the RESPONSE but not the read: the whole file landed in memory
 * first, and the file is written by an agent, so nothing here bounds its size. `truncated` is part
 * of the contract — a silently clipped report reads as a complete one, the same failure as a
 * cancelled run reading as done.
 */
export function readReportCapped(file, cap = REPORT_CAP) {
  const empty = { report: '', truncated: false, bytes: 0 }
  let bytes
  try { bytes = fs.statSync(file).size } catch { return empty }
  if (bytes <= cap) {
    try { return { report: fs.readFileSync(file, 'utf8'), truncated: false, bytes } } catch { return empty }
  }
  let fd = null
  try {
    fd = fs.openSync(file, 'r')
    const buf = Buffer.alloc(cap)
    const got = fs.readSync(fd, buf, 0, cap, 0)
    // A multi-byte character straddling the cap decodes to U+FFFD; drop that partial tail rather
    // than end the report on a replacement glyph.
    return { report: buf.toString('utf8', 0, got).replace(/�+$/, ''), truncated: true, bytes }
  } catch { return empty }
  finally { if (fd !== null) { try { fs.closeSync(fd) } catch {} } }
}

/**
 * One run as the client sees it.
 *
 * `done` means "finished and produced a report" — nothing else. A cancelled or errored run reports
 * `done:false` with its own status, because a cancelled run that reads as complete is a report the
 * user will trust without knowing it stopped halfway.
 */
export function researchView(r) {
  return {
    id: r.id,
    question: r.question,
    cwd: r.cwd || null,
    at: r.at,
    status: r.status,
    done: r.status === 'done',
    running: r.status === 'running',
    reportBytes: r.reportBytes || 0,
    error: r.error || null,
    ms: r.ms ?? null,
    cost: r.cost ?? null,
  }
}

/**
 * A meta.json from disk, reconciled against what is actually running.
 *
 * A run recorded as `running` that this process knows nothing about is a run the previous server
 * process was killed in the middle of. It is reported as `interrupted`, not `running` — nothing
 * will ever advance it, and nothing will ever finish it.
 */
const fromMeta = m => researchView({ ...m, status: m.status === 'running' && !runs.has(m.id) ? 'interrupted' : m.status })

/** Frames a client at `rawFromSeq` is owed, plus the gap notice when the gap cannot be served. */
export function sseFrames(run, rawFromSeq) {
  const n = Number(rawFromSeq)
  const from = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0
  const r = replayFrom(run, from)
  // Handing back the surviving tail alone would leave the client believing it has the whole run.
  const gap = r.complete ? null
    : { kind: 'gap', payload: { earliestSeq: r.earliestSeq ?? null, requestedFrom: from, dropped: r.evicted || 0, reason: r.reason } }
  return { gap, frames: r.frames }
}

function push(r, kind, payload) {
  const { ok, frame } = emit(r.run, kind, payload)
  if (!ok) return
  const line = `data: ${JSON.stringify(frame)}\n\n`
  for (const l of r.listeners) { if (!l.writableEnded) { try { l.write(line) } catch { r.listeners.delete(l) } } }
}

function readReportBytes(id) {
  const p = runPaths(id)
  try { return p ? fs.statSync(p.report).size : 0 } catch { return 0 }
}

/**
 * Ids of finished runs the live map can forget, oldest first.
 *
 * A run whose child is STILL ALIVE is never forgotten, whatever its status: this map holds the only
 * reference to that process handle, so evicting it makes the child unkillable — it would keep
 * running, keep spending, and could still overwrite report.md with nothing left able to stop it.
 * That is exactly the state a force-finished cancel is in.
 */
export function evictableIds(entries, keep = KEEP_FINISHED) {
  const finished = entries.filter(x => x.status !== 'running').sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
  return finished.slice(0, Math.max(0, finished.length - keep))
    .filter(x => !x.listeners?.size && !x.child?.alive)
    .map(x => x.id)
}

/**
 * Terminal transition. The report file is the deliverable, so if the agent answered in prose
 * without writing it, the prose is saved rather than discarded — a run that did the work and
 * skipped the last instruction should not lose the work.
 */
function finish(r, { error }) {
  if (r.status !== 'running') return
  const p = runPaths(r.id)
  r.status = r.cancelled ? 'cancelled' : error ? 'error' : 'done'
  r.error = r.cancelled ? null : error || null
  r.ms = Date.now() - Date.parse(r.at) || null
  if (p && !r.cancelled && !r.deleted && !fs.existsSync(p.report) && r.text.trim()) {
    try { fs.mkdirSync(p.dir, { recursive: true }); fs.writeFileSync(p.report, r.text) } catch {}
  }
  r.reportBytes = readReportBytes(r.id)
  if (r.status === 'done' && !r.reportBytes) { r.status = 'error'; r.error = 'the run finished without producing a report' }
  // A deleted run writes nothing back. writeMeta mkdirs its directory, which would undo the delete.
  if (!r.deleted) writeMeta(r)
  push(r, 'complete', researchView(r))
  for (const l of r.listeners) { try { l.end() } catch {} }
  r.listeners.clear()
  for (const id of evictableIds([...runs.values()])) runs.delete(id)
}

/**
 * SIGTERM, then SIGKILL if the child is still there. `then` runs after the escalation, so a caller
 * that force-finishes the run does it once the process is actually gone rather than marking a
 * still-running child terminal.
 */
function killEscalating(r, then) {
  r.child?.kill('SIGTERM')
  setTimeout(() => {
    if (r.child?.alive) r.child.kill('SIGKILL')
    then?.()
  }, KILL_GRACE_MS).unref?.()
}

export default function mount(app) {
  app.post('/api/research', (req, res) => {
    const question = String(req.body?.question || '').trim()
    if (!question) return res.status(400).json({ error: 'question is required' })
    if (question.length > MAX_QUESTION) return res.status(400).json({ error: `question is longer than ${MAX_QUESTION} characters` })
    const live = [...runs.values()].filter(r => r.status === 'running')
    if (live.length >= MAX_LIVE)
      return res.status(429).json({ error: `${live.length} research runs are already in flight`, detail: 'wait for one to finish, or cancel it' })
    // Becomes a child process's working directory, so it gets the same check the sibling module
    // applies (server/compare.mjs). A relative path would resolve against the SERVER's cwd rather
    // than anything the caller meant, and a path to a file fails the spawn with a confusing error.
    const wanted = req.body?.cwd
    if (wanted != null && !(typeof wanted === 'string' && path.isAbsolute(wanted)))
      return res.status(400).json({ error: 'cwd must be an absolute path' })
    let cwd = os.homedir()
    if (wanted) {
      try { if (!fs.statSync(wanted).isDirectory()) return res.status(400).json({ error: 'cwd is not a directory' }) }
      catch { return res.status(400).json({ error: 'cwd does not exist', path: wanted }) }
      cwd = wanted
    }

    const id = newId()
    const p = runPaths(id)
    try { fs.mkdirSync(p.dir, { recursive: true }) }
    catch (e) { return res.status(500).json({ error: `could not create the report folder: ${e.message}` }) }

    const r = {
      id, question, cwd, at: new Date().toISOString(), status: 'running', error: null,
      reportBytes: 0, ms: null, cost: null, cancelled: false, text: '',
      run: createRun(id), listeners: new Set(), child: null,
    }
    runs.set(id, r)
    writeMeta(r)

    r.child = spawnAgent({
      cwd,
      prompt: researchPrompt(question, p.report),
      model: req.body?.model || undefined,
      onEvent: ev => {
        // Assistant prose is kept as the fallback report and for nothing else; capped so a chatty
        // run cannot grow server memory without bound.
        if (ev.type === 'assistant' && Array.isArray(ev.message?.content) && r.text.length < REPORT_CAP)
          for (const c of ev.message.content) if (c.type === 'text') r.text += c.text + '\n\n'
        if (ev.type === 'result' && typeof ev.total_cost_usd === 'number') r.cost = ev.total_cost_usd
        push(r, 'event', ev)
      },
      // The exit CODE matters as much as the error. A child killed by a signal, or exiting non-zero
      // without having written to stderr, arrives here with error:null — and a run that also left a
      // partial report.md behind would then be published as `done`. A report from a process that
      // died is a report a user would trust without knowing it was cut short.
      onExit: ({ error, code }) => finish(r, { error: error || (code ? `the research process exited with code ${code}` : null) }),
    })
    res.json({ id })
  })

  // Library: disk is the archive, so past reports survive a dashboard restart. Live runs overlay it.
  app.get('/api/research', (req, res) => {
    let names = []
    try { names = fs.readdirSync(RESEARCH_DIR) } catch {}
    const out = []
    for (const name of names) {
      if (!validId(name)) continue
      const m = readMeta(runPaths(name).meta)
      if (!m) continue
      const live = runs.get(name)
      out.push(live ? researchView(live) : fromMeta({ ...m, id: name }))
    }
    for (const r of runs.values()) if (!out.some(o => o.id === r.id)) out.push(researchView(r))
    out.sort((a, b) => Date.parse(b.at) - Date.parse(a.at))
    res.json(out)
  })

  app.get('/api/research/:id', (req, res) => {
    const p = runPaths(req.params.id)
    if (!p) return res.status(400).json({ error: 'invalid research id' })
    const live = runs.get(req.params.id)
    const m = live ? null : readMeta(p.meta)
    if (!live && !m) return res.status(404).json({ error: 'no such research run' })
    // `reportTruncated` travels with the body: the client cannot tell a clipped report from a whole
    // one by looking at it, and `reportTotalBytes` is what it should have been.
    const { report, truncated, bytes } = readReportCapped(p.report)
    const view = live ? researchView(live) : fromMeta({ ...m, id: req.params.id })
    res.json({ ...view, report, reportTruncated: truncated, reportTotalBytes: bytes })
  })

  // Replay then live, so a browser refresh mid-research resumes instead of restarting.
  app.get('/api/research/:id/events', (req, res) => {
    if (!validId(req.params.id)) return res.status(400).json({ error: 'invalid research id' })
    const r = runs.get(req.params.id)
    if (!r) return res.status(404).json({ error: 'no live run for this id — read the report instead' })
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
    res.write(': connected\n\n')
    // The gap notice goes first, so the client learns its history is incomplete before it starts
    // applying the surviving tail.
    const { gap, frames } = sseFrames(r.run, req.query.fromSeq)
    if (gap) res.write(`data: ${JSON.stringify(gap)}\n\n`)
    for (const f of frames) res.write(`data: ${JSON.stringify(f)}\n\n`)
    if (r.status !== 'running') return res.end()
    r.listeners.add(res)
    req.on('close', () => r.listeners.delete(res))
  })

  app.post('/api/research/:id/cancel', (req, res) => {
    if (!validId(req.params.id)) return res.status(400).json({ error: 'invalid research id' })
    const r = runs.get(req.params.id)
    if (!r || r.status !== 'running') return res.status(404).json({ error: 'no research run in flight for this id' })
    r.cancelled = true
    // The child's exit drives `finish`, but a child that never exits must not leave the run reading
    // as running forever — and SIGTERM alone cannot promise that, so the grace period ends in
    // SIGKILL. Force-finishing BEFORE the kill would publish a terminal run whose agent is still
    // searching, still spending, and still able to write report.md.
    killEscalating(r, () => finish(r, { error: null }))
    res.json({ ok: true })
  })

  app.delete('/api/research/:id', (req, res) => {
    const p = runPaths(req.params.id)
    if (!p) return res.status(400).json({ error: 'invalid research id' })
    const r = runs.get(req.params.id)
    if (r?.status === 'running') {
      // Deleting a RUNNING run is a race with its own child. Killing it makes `finish` fire, and
      // `finish` calls writeMeta, which mkdirs the directory back — so the run reappeared in the
      // library seconds after being deleted. `deleted` makes finish skip every disk write, so the
      // rm below is the last word.
      r.cancelled = true
      r.deleted = true
      // Escalated for the same reason as cancel, and more urgently: the run leaves the map below, so
      // this closure holds the last reference able to kill a child that shrugged off SIGTERM.
      killEscalating(r)
    }
    runs.delete(req.params.id)
    try { fs.rmSync(p.dir, { recursive: true, force: true }) }
    catch (e) { return res.status(500).json({ error: `could not delete the report: ${e.message}` }) }
    res.json({ ok: true })
  })
}
