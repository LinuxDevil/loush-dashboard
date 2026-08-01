// Compare — blind side-by-side model testing and synthesis.
//
// AGPL-3.0-only. Derived from Odysseus (https://github.com/odysseus-dev/odysseus),
// Copyright (c) the Odysseus contributors, AGPL-3.0. `routes/compare/compare_routes.py` was read
// while writing this file — see NOTICE, "Third-party code", clause 1.
//
// Changed from upstream (AGPL §5(a), 2026-07-31): upstream compares exactly TWO models over two
// ephemeral streaming chat sessions bound to per-user model endpoints, and stores a
// `{left,right} → {a,b}` blind mapping in SQL. This is N models (max 6) behind labels A…F, run
// through the local `claude` CLI by `runAgent`, persisted as one JSON file per comparison under
// ~/.claude/dashboard-compare. Upstream's endpoint/api-key ownership scoping has no analogue here
// (single local user, no stored credentials) and is dropped. What is kept is the property the
// feature exists for: the label→model mapping is withheld from every read until a vote lands.
//
// ponytail: no streaming panes, no provider probe, no model catalogue, no ELO. v1 awaits
// `runAgent`, which resolves when the run is done — the same shape server/ticket.mjs already uses.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { runAgent as defaultRunAgent } from '../lib/agent.mjs'

const DIR = () => path.join(os.homedir(), '.claude', 'dashboard-compare')

export const LABELS = ['A', 'B', 'C', 'D', 'E', 'F']
export const MAX_MODELS = LABELS.length

// The two bounds Compare was the only agent-spawning module without.
//
// MAX_PROMPT — the prompt is fanned out to one CLI spawn per model, so the same text is paid for up
// to MAX_MODELS times over. 2000 is research.mjs's MAX_QUESTION and docs.mjs's
// MAX_INSTRUCTION_CHARS, and a compare prompt is the same kind of thing: a request, not a document.
//
// RUN_TIMEOUT_MS — `runAgent` defaults to 30 minutes, and up to MAX_MODELS of those run under one
// `Promise.all` holding the HTTP response open, with nothing to poll and no way to cancel. 300_000
// is board.mjs's timeout for a single question-shaped agent run, which is what one pane is.
export const MAX_PROMPT = 2000
export const RUN_TIMEOUT_MS = 300_000

// The id reaches the filesystem straight off the URL, so the shape is fixed here and every path
// is built through `fileFor`. `randomBytes(5).toString('hex')` is 10 lowercase hex chars, inside
// the range this accepts.
const ID_RE = /^[a-z0-9]{6,12}$/
const newId = () => randomBytes(5).toString('hex')

const fileFor = id => {
  if (!ID_RE.test(String(id || ''))) throw Object.assign(new Error('invalid comparison id'), { status: 400 })
  return path.join(DIR(), `${id}.json`)
}

/**
 * Pair each model with a label in random order.
 *
 * A permutation, not a per-label draw: every model gets exactly one label and every label exactly
 * one model, so a comparison can never show the same answer twice or silently drop a contender.
 */
export function assignLabels(models, rand = Math.random) {
  const pool = [...models]
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[pool[i], pool[j]] = [pool[j], pool[i]]
  }
  return pool.map((model, i) => ({ label: LABELS[i], model }))
}

/**
 * The wire form of one stored comparison.
 *
 * `model`, and the per-pane cost / latency / turns, are present ONLY once a vote exists. Names are
 * the obvious leak; the numbers are the subtle one — Opus and Haiku are told apart by price and
 * latency alone, so serving those before the vote would de-anonymise the panes just as thoroughly.
 * The keys stay in the payload as nulls so the client renders one shape throughout.
 *
 * The error TEXT is withheld on the same grounds, and it is the leak that nearly shipped. It is
 * `runAgent`'s raw CLI stderr from a process invoked as `--model <name>`, so an unavailable,
 * misspelled or unentitled model prints its own name into it. That made the one case where
 * blindness matters most — you can see a contender crashed — also the case that told you which
 * contender it was. `failed` carries the fact; the text waits for the vote.
 */
function view(rec) {
  const voted = !!rec.vote
  return {
    id: rec.id,
    prompt: rec.prompt,
    cwd: rec.cwd,
    at: rec.at,
    voted,
    vote: voted ? rec.vote : null,
    synthesis: rec.synthesis || null,
    panes: rec.panes.map(p => ({
      label: p.label,
      text: p.text,
      failed: !!p.error,
      error: voted ? (p.error || null) : null,
      model: voted ? p.model : null,
      cost: voted ? p.cost : null,
      ms: voted ? p.ms : null,
      turns: voted ? p.turns : null,
    })),
    ...(voted ? { mapping: Object.fromEntries(rec.panes.map(p => [p.label, p.model])) } : {}),
  }
}

const read = id => {
  const file = fileFor(id)
  try { return JSON.parse(fs.readFileSync(file, 'utf8')) }
  catch { throw Object.assign(new Error('no such comparison'), { status: 404 }) }
}

// Temp file then rename, because rename(2) is atomic within a filesystem: a reader sees the whole
// old file or the whole new one. Truncating in place could not promise that, and a half-written file
// is not a cosmetic loss — `read` reports it as a 404 and the list route skips it, so the
// comparison vanishes. The temp name deliberately does not end in `.json`, so one left behind by a
// crash cannot be picked up by the list route's readdir filter.
const write = rec => {
  fs.mkdirSync(DIR(), { recursive: true })
  const file = fileFor(rec.id)
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(rec, null, 2))
  fs.renameSync(tmp, file)
}

/** Validate the request body for a new comparison, or throw with an HTTP status attached. */
function parseRequest(body) {
  const cwd = String(body?.cwd || '')
  const prompt = String(body?.prompt || '').trim()
  const models = Array.isArray(body?.models) ? body.models.map(m => String(m || '').trim()).filter(Boolean) : []
  const bad = msg => { throw Object.assign(new Error(msg), { status: 400 }) }

  if (!prompt) bad('prompt is required')
  if (prompt.length > MAX_PROMPT) bad(`prompt is longer than ${MAX_PROMPT} characters — it is sent to every model, so it is paid for up to ${MAX_MODELS} times over`)
  if (!models.length) bad('models must be a non-empty array')
  if (models.length > MAX_MODELS) bad(`at most ${MAX_MODELS} models — there are only ${MAX_MODELS} labels`)
  if (new Set(models).size !== models.length) bad('the same model twice is not a comparison')
  if (!cwd || !path.isAbsolute(cwd)) bad('cwd must be an absolute path')
  try { if (!fs.statSync(cwd).isDirectory()) bad('cwd is not a directory') }
  catch (e) { if (e.status) throw e; bad('cwd does not exist: ' + cwd) }
  return { cwd, prompt, models }
}

const SYNTH_HEADER = 'You are given several independent answers to the same request. Write one answer that is better than any of them: keep what each got right, drop what is wrong or redundant, and resolve contradictions explicitly. Reply with the answer only.'

const synthPrompt = rec => [
  SYNTH_HEADER,
  `\n## The original request\n${rec.prompt}`,
  ...rec.panes.filter(p => p.text).map(p => `\n## Answer ${p.label}\n${p.text}`),
].join('\n')

export default function mountCompare(app, deps = {}) {
  const runAgent = deps.runAgent || defaultRunAgent
  const fail = (res, e) => res.status(e.status || 500).json({ error: String(e.message || e) })

  // Ids with a vote being written. A vote is read → check → write, and if those interleave both
  // callers pass the check and the second write replaces the first vote with a different one.
  //
  // ponytail: not reachable today — the vote handler is synchronous end to end, so Node runs it to
  // completion before the next request. This holds the invariant locally instead of resting on that,
  // and it is a Set rather than a lock manager because there is one local user and one process.
  // Ceiling: per-process, so two servers over one ~/.claude still race; `write` keeps each file
  // whole but does not serialise writers. Per-id file locks if that ever becomes real.
  const voting = new Set()

  // A run blocks the request until every model has answered. That is deliberate for v1: `runAgent`
  // is buffered and hands back no handle, so there is nothing to poll and no partial pane to show.
  // Bounded per pane by RUN_TIMEOUT_MS, or the response is held open for runAgent's 30-min default.
  app.post('/api/compare', async (req, res) => {
    try {
      const { cwd, prompt, models } = parseRequest(req.body)
      const runs = await Promise.all(assignLabels(models).map(async ({ label, model }) => {
        // A model that fails becomes a pane carrying its error. Dropping it would make the
        // comparison look like it had fewer contenders than it did. A timeout is one such error.
        const r = await runAgent({ cwd, prompt, model, timeoutMs: RUN_TIMEOUT_MS })
        return { label, model, text: r.result || '', error: r.error || null, cost: r.cost || 0, ms: r.ms || 0, turns: r.turns || 0 }
      }))
      // Stored in label order, so the file itself does not leak the order they were requested in.
      const rec = { id: newId(), prompt, cwd, at: Date.now(), panes: runs.sort((a, b) => a.label.localeCompare(b.label)), vote: null, synthesis: null }
      write(rec)
      res.json({ id: rec.id })
    } catch (e) { fail(res, e) }
  })

  // `models` is a COUNT, never the names — the list is read before voting too.
  app.get('/api/compare', (req, res) => {
    try {
      const files = fs.existsSync(DIR()) ? fs.readdirSync(DIR()).filter(f => f.endsWith('.json')) : []
      const out = files
        // This path is built outside fileFor(), which is safe ONLY because `f` comes from readdirSync
        // and never from a request. Any new route that takes an id from the caller must go through
        // fileFor() — the id validation lives there, not here.
        .map(f => { try { return JSON.parse(fs.readFileSync(path.join(DIR(), f), 'utf8')) } catch { return null } })
        .filter(rec => rec && ID_RE.test(String(rec.id || '')))
        .map(rec => ({ id: rec.id, prompt: rec.prompt, at: rec.at, models: (rec.panes || []).length, voted: !!rec.vote }))
      res.json(out.sort((a, b) => b.at - a.at).slice(0, 50))
    } catch (e) { fail(res, e) }
  })

  app.get('/api/compare/:id', (req, res) => {
    try { res.json(view(read(req.params.id))) } catch (e) { fail(res, e) }
  })

  app.post('/api/compare/:id/vote', (req, res) => {
    let held = null
    try {
      const rec = read(req.params.id)
      if (rec.vote || voting.has(rec.id)) return res.status(409).json({ error: 'already voted' })
      const pane = rec.panes.find(p => p.label === String(req.body?.label || ''))
      if (!pane) return res.status(400).json({ error: `label must be one of: ${rec.panes.map(p => p.label).join(', ')}` })
      voting.add((held = rec.id))
      rec.vote = { label: pane.label, model: pane.model, at: Date.now() }
      write(rec)
      res.json({ ok: true, vote: rec.vote, mapping: Object.fromEntries(rec.panes.map(p => [p.label, p.model])) })
    } catch (e) { fail(res, e) }
    finally { if (held) voting.delete(held) }
  })

  // Refused before a vote: the synthesis is written by a named model, and naming it reveals a
  // model that was in the comparison.
  //
  // Not covered by `voting`: this awaits an agent between its read and its write, so two concurrent
  // synthesises of one comparison end in last-write-wins. That replaces one synthesis with another
  // rather than destroying a vote, so it is left as it is.
  app.post('/api/compare/:id/synthesize', async (req, res) => {
    try {
      const rec = read(req.params.id)
      if (!rec.vote) return res.status(409).json({ error: 'vote first — synthesising would reveal a model' })
      if (!rec.panes.some(p => p.text)) return res.status(409).json({ error: 'nothing to synthesise — every model errored' })
      const model = String(req.body?.model || '') || rec.vote.model
      const r = await runAgent({ cwd: rec.cwd, prompt: synthPrompt(rec), model, timeoutMs: RUN_TIMEOUT_MS })
      if (r.error) return res.status(502).json({ error: r.error })
      rec.synthesis = { text: r.result || '', model, cost: r.cost || 0, ms: r.ms || 0, at: Date.now() }
      write(rec)
      res.json(rec.synthesis)
    } catch (e) { fail(res, e) }
  })

  app.delete('/api/compare/:id', (req, res) => {
    try {
      const file = fileFor(req.params.id)
      if (!fs.existsSync(file)) return res.status(404).json({ error: 'no such comparison' })
      fs.rmSync(file)
      res.json({ ok: true })
    } catch (e) { fail(res, e) }
  })

  return { DIR, view, assignLabels }
}
