// Routes for the four libraries that had none.
//
// Each was built, tested, and imported by nothing — which is not a shipped feature. The wiring is
// where the last batch's bugs all lived (arguments reversed, an un-awaited promise, a linter given
// no targets), so every contract below was read from the library first rather than assumed, and
// each route is exercised against the running server before it is called done.

import fs from 'node:fs'
import path from 'node:path'
import { CLAUDE, PROJECT, readJson } from './dashboard-core.mjs'
import { createTracker, trackerToolSchemas, TRACKER_STATUSES } from '../lib/tracker.mjs'
import { runInsightRules, runInsightRulesForAll, missingFieldsFor, RULES as INSIGHT_RULES } from '../lib/insight-rules/index.mjs'
import { createDiffReviewStore } from '../lib/diff-review.mjs'
import { watchRepo, WATCH_DEFAULTS, EVENTS as WATCH_EVENTS } from '../lib/git-watch.mjs'

const TRACKER_FILE = path.join(CLAUDE, 'tracker.json')

export default function mountWave4(app, deps = {}) {
  const rootList = () => {
    const r = deps.projectDirs ? deps.projectDirs() : [PROJECT]
    return r instanceof Set ? [...r] : Array.isArray(r) ? r : r ? [r] : []
  }
  // Every path-taking route here constrains the client-supplied directory to a configured project
  // root, checked on the RESOLVED path. Same rule as the wave-3 routes; repeated rather than
  // shared because a guard that lives somewhere else is a guard someone forgets to call.
  const inRoots = dir => {
    const resolved = path.resolve(dir)
    return rootList().some(r => resolved === path.resolve(r) || resolved.startsWith(path.resolve(r) + path.sep))
  }

  // ---- 093: agent-writable tracker ----------------------------------------------------------
  //
  // File-backed. `read` returns whatever is on disk (or an empty state); `write` replaces it.
  // Note what is NOT injected: `knownSessionIds`. The library treats an absent provider as "not
  // checked" and an empty array as "checked, found nothing" — supplying [] here would make every
  // session link report as unverified-because-missing rather than unverified-because-unchecked.
  const tracker = createTracker({
    read: () => readJson(TRACKER_FILE, { items: {} }),
    write: state => fs.writeFileSync(TRACKER_FILE, JSON.stringify(state, null, 2)),
    allowedStatuses: () => TRACKER_STATUSES,
    knownProjects: () => rootList(),
  })

  app.get('/api/tracker', async (req, res) => {
    try {
      const q = {}
      for (const k of ['status', 'project', 'type', 'q', 'limit', 'offset']) if (req.query[k] !== undefined) q[k] = req.query[k]
      const r = await tracker.tracker_list(q)
      res.status(r.ok === false ? 400 : 200).json(r)
    } catch (e) { res.status(500).json({ error: e.message }) }
  })
  app.post('/api/tracker', async (req, res) => {
    try {
      const r = await tracker.tracker_create(req.body ?? {})
      res.status(r.ok === false ? 400 : 200).json(r)
    } catch (e) { res.status(500).json({ error: e.message }) }
  })
  app.patch('/api/tracker/:id', async (req, res) => {
    try {
      const r = await tracker.tracker_update({ ...(req.body ?? {}), id: req.params.id })
      // A version conflict is 409, not 400 — the caller's input was well-formed, the board moved.
      const code = r.ok === false ? (r.reason === 'version_conflict' || r.error === 'version_conflict' ? 409 : 400) : 200
      res.status(code).json(r)
    } catch (e) { res.status(500).json({ error: e.message }) }
  })
  app.post('/api/tracker/:id/link-session', async (req, res) => {
    try {
      const r = await tracker.tracker_link_session({ ...(req.body ?? {}), id: req.params.id })
      res.status(r.ok === false ? 400 : 200).json(r)
    } catch (e) { res.status(500).json({ error: e.message }) }
  })
  // The tool schemas an agent reads. Generated from the same constants the validators use, so the
  // description cannot drift from the rules the input is judged by.
  app.get('/api/tracker/schemas', (req, res) => res.json({ tools: tracker.schemas(), statuses: TRACKER_STATUSES }))

  // ---- 072: insight rules ---------------------------------------------------------------------
  //
  // Rules read named fields off a session. `missingFieldsFor` reports which a rule could not find,
  // so a rule that never fires because of a WIRING gap is distinguishable from one that never
  // fires because there is nothing to report — the difference between a bug and a clean run.
  const sessionsFor = () => {
    if (!deps.sessionRows) return null
    try { const r = deps.sessionRows(); return Array.isArray(r) ? r : null } catch { return null }
  }
  app.get('/api/insights', (req, res) => {
    try {
      const sessions = sessionsFor()
      if (!sessions) {
        return res.status(501).json({ error: 'session rows are not wired into this server', detail: 'the insight engine has no sessions to run against; this is a wiring gap, not an empty result' })
      }
      const results = runInsightRulesForAll(sessions)
      const insights = results.flatMap(r => (r.insights || []).map(i => ({ ...i, sessionId: r.sessionId })))
      // Rule coverage travels with the answer. "No insights" over a corpus where every rule was
      // starved of its input is not the same claim as "no insights" over a healthy run.
      const gaps = sessions.length ? missingFieldsFor(sessions[0]) : null
      res.json({
        insights,
        sessions: sessions.length,
        rules: INSIGHT_RULES.map(r => ({ id: r.id, needs: r.needs, peers: !!r.peers })),
        fieldGaps: gaps,
        // The library names these `abstentions` and `failures`, and I first read them as
        // `skipped`/`failed` — which silently dropped every explanation and made "0 insights"
        // look like a clean bill of health. An abstention carries WHY the rule could not judge
        // (below a sample floor, no peer baseline, a field not reported), and that is the whole
        // difference between "nothing to report" and "nothing could be evaluated".
        abstentions: results.flatMap(r => (r.abstentions || []).map(a => ({ ...a, sessionId: r.sessionId }))),
        failures: results.flatMap(r => (r.failures || []).map(f => ({ ...f, sessionId: r.sessionId }))),
        rulesRun: results.reduce((n, r) => n + (r.rulesRun || 0), 0),
        complete: results.every(r => r.complete !== false),
        bounds: results.map(r => r.bounds).filter(Boolean),
        note: sessions.length === 0
          ? 'no sessions were available, so no rule ran — this is "not checked", not "nothing to report"'
          : (insights.length === 0
            ? `every rule abstained across ${sessions.length} session(s) — see abstentions for why; this is not a finding of "no problems"`
            : null),
      })
    } catch (e) { res.status(500).json({ error: e.message }) }
  })
  app.get('/api/insights/:sessionId', (req, res) => {
    try {
      const sessions = sessionsFor()
      if (!sessions) return res.status(501).json({ error: 'session rows are not wired into this server' })
      const s = sessions.find(x => x.sessionId === req.params.sessionId)
      if (!s) return res.status(404).json({ error: `no session ${req.params.sessionId} in the current scan`, scanned: sessions.length })
      res.json({ ...runInsightRules(s, sessions), missingFields: missingFieldsFor(s) })
    } catch (e) { res.status(500).json({ error: e.message }) }
  })

  // ---- 074: diff review -----------------------------------------------------------------------
  //
  // Degraded mode by default: without a PreToolUse hook the "original" is inferred from the last
  // content we saw, not observed before the edit. The store says so on every review, and this
  // route does not override it — claiming hook-grade confidence we were not given would make
  // every `originalConfidence: 'observed'` a lie.
  // Namespaced /api/diff-reviews, NOT /api/reviews — server/drift.mjs already owns that path, and
  // express gives it to whichever route registered first. My GET was silently shadowed and
  // returned drift's payload: a route that answers with someone else's data is worse than a 404,
  // because the client renders it.
  const reviews = createDiffReviewStore({})
  const guardPath = (p, res) => {
    if (typeof p !== 'string' || !p.trim()) { res.status(400).json({ error: 'path required' }); return false }
    if (!inRoots(p)) { res.status(403).json({ error: 'not inside a configured project directory', path: path.resolve(p), roots: rootList() }); return false }
    return true
  }
  app.get('/api/diff-reviews', (req, res) => res.json({
    pending: reviews.listPending(), history: reviews.history(), status: reviews.status(),
  }))
  app.get('/api/diff-reviews/:id/diff', (req, res) => {
    const d = reviews.diff(req.params.id)
    if (!d || d.ok === false) return res.status(404).json(d || { ok: false, reason: 'no such review' })
    res.json(d)
  })
  app.post('/api/diff-reviews/snapshot', (req, res) => {
    const p = String(req.body?.path ?? '')
    if (!guardPath(p, res)) return
    try {
      const r = reviews.snapshot(p, req.body?.content ?? undefined, { source: req.body?.source ?? 'api' })
      res.status(r.ok === false ? 400 : 200).json(r)
    } catch (e) { res.status(500).json({ error: e.message }) }
  })
  // recordEdit is the "an agent just wrote this file" signal. Consecutive edits to the same file
  // coalesce into ONE review against the FIRST original, rather than stacking N reviews a human
  // then has to approve in sequence to see one net change.
  app.post('/api/diff-reviews/edit', (req, res) => {
    const p = String(req.body?.path ?? '')
    if (!guardPath(p, res)) return
    try {
      const r = reviews.recordEdit(p, req.body?.content ?? undefined, { source: req.body?.source ?? 'api' })
      res.status(r.ok === false ? 400 : 200).json(r)
    } catch (e) { res.status(500).json({ error: e.message }) }
  })
  app.post('/api/diff-reviews/:id/accept', (req, res) => {
    try {
      const r = reviews.accept(req.params.id)
      res.status(r.ok === false ? 409 : 200).json(r)
    } catch (e) { res.status(500).json({ error: e.message }) }
  })
  app.post('/api/diff-reviews/:id/reject', (req, res) => {
    try {
      // Rejecting RESTORES the original. If the file changed since the snapshot, restoring would
      // destroy that change — the store refuses. Forcing is a SEPARATE method taking a literal
      // acknowledgement string, not a truthy flag, so a stray `force:true` cannot discard work;
      // the wrong string is rejected by the store.
      const ack = req.body?.acknowledgement
      const r = ack === undefined ? reviews.reject(req.params.id) : reviews.rejectForce(req.params.id, ack)
      res.status(r.ok === false ? 409 : 200).json(r)
    } catch (e) { res.status(500).json({ error: e.message }) }
  })

  // ---- 095: event-driven git watching ---------------------------------------------------------
  //
  // One watcher per repo, shared by every SSE listener. A watch that FAILS to establish is
  // reported rather than silently degraded to nothing: a UI that looks live and is frozen is worse
  // than one that says it is polling.
  const watchers = new Map()   // dir -> { handle, listeners:Set, last }
  const watcherFor = dir => {
    let w = watchers.get(dir)
    if (w) return w
    const handle = watchRepo(dir, {})
    w = { handle, listeners: new Set(), last: null }
    watchers.set(dir, w)
    const relay = (type, payload) => {
      w.last = { type, at: new Date().toISOString(), ...payload }
      const line = `data: ${JSON.stringify(w.last)}\n\n`
      for (const l of w.listeners) { if (!l.writableEnded) { try { l.write(line) } catch { w.listeners.delete(l) } } }
    }
    for (const ev of Object.values(WATCH_EVENTS)) handle.on?.(ev, payload => relay(ev, payload || {}))
    handle.on?.('error', e => relay('error', { message: e?.message || String(e) }))
    return w
  }
  app.get('/api/git/watch', (req, res) => {
    const dir = String(req.query.dir || rootList()[0] || PROJECT)
    if (!inRoots(dir)) return res.status(403).json({ error: 'not inside a configured project directory', dir: path.resolve(dir), roots: rootList() })
    const w = watcherFor(dir)
    // The handle reports establishment inline (ok / degraded / reason / fallback), not via a
    // status() method — read from the object rather than assuming an accessor exists.
    const h = w.handle
    const st = { watching: h.ok === true, degraded: !!h.degraded, reason: h.reason ?? null, fallback: h.fallback ?? null, locked: !!h.locked, root: h.root ?? null, head: h.head ?? null }
    res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
    // The first frame states whether watching actually established, and on what. A client that
    // gets `watching:false` knows to poll instead of trusting silence.
    res.write(`data: ${JSON.stringify({ type: 'watch_state', dir, ...st, defaults: WATCH_DEFAULTS, note: st.watching ? null : `not watching (${st.reason || 'no reason given'}) — poll instead; a silent stream here would look live and be frozen` })}\n\n`)
    if (w.last) res.write(`data: ${JSON.stringify({ ...w.last, replayed: true })}\n\n`)
    w.listeners.add(res)
    req.on('close', () => {
      w.listeners.delete(res)
      // Last listener out disposes the watch — an undisposed fs.watch holds the event loop open
      // and keeps firing for a repo nobody is looking at.
      if (!w.listeners.size) { try { w.handle.dispose?.() } catch {} ; watchers.delete(dir) }
    })
  })
  app.get('/api/git/watch/status', (req, res) => {
    const dir = String(req.query.dir || rootList()[0] || PROJECT)
    if (!inRoots(dir)) return res.status(403).json({ error: 'not inside a configured project directory' })
    const w = watchers.get(dir)
    res.json({
      dir, active: !!w, listeners: w ? w.listeners.size : 0,
      status: w ? { watching: w.handle.ok === true, degraded: !!w.handle.degraded, reason: w.handle.reason ?? null, fallback: w.handle.fallback ?? null } : null,
      last: w?.last ?? null,
      note: w ? null : 'no watcher is running for this directory — open /api/git/watch to start one',
    })
  })
}
