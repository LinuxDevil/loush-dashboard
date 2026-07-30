// src/lib/editorHost.js — feature 076: the uniform lifecycle contract every file-type viewer implements.
//
// WHY THIS EXISTS
// ---------------
// Today each viewer in src/ui/viewers.jsx invents its own loading, its own error text, and (for the
// editable ones) its own save. Adding a watcher, a diff mode or a theme switch means touching every
// branch of `Viewer`. This module is the one place that owns: load → ready → save → reload, echo
// suppression, and the diff baseline.
//
// THE LOAD-BEARING RULE: CONTENT NEVER LIVES IN REACT STATE.
// ---------------------------------------------------------
// The host pushes text into the editor with `applyContent` and pulls it back with `getCurrentContent`.
// It does NOT keep the buffer in a useState. Reasons, concretely:
//
//   * Lost keystrokes. React state updates are asynchronous and batched. A watcher event that arrives
//     mid-render sets state from disk; the keystroke the user typed 4ms earlier is still queued in the
//     other setState and gets clobbered by the re-render. The user watches a character vanish.
//   * Save races. If the buffer is state, "save" saves whatever the last committed render had, not what
//     is on screen right now. Under fast typing you persist a version the user never saw.
//   * Cursor destruction. Re-rendering a CodeMirror with a new `value` prop resets selection and scroll
//     on every external event.
//
// So: the editor instance is the single source of truth for text. React state here holds only the
// lifecycle *status* (a small enum) and metadata — things that are cheap and safe to re-render on.

import { computeLineDiff } from './lineDiff.js'

/** Members every viewer adapter must supply for the host to drive it. */
export const ADAPTER_MEMBERS = ['applyContent', 'getCurrentContent']
/** Optional members. Missing ones degrade a capability — reported, never silently ignored. */
export const ADAPTER_OPTIONAL = ['setTheme', 'onDirty', 'destroy']

/**
 * Check an adapter before we drive it. Never throws — a viewer that forgot a method must produce a
 * readable message in the UI, not a white screen.
 * @returns {{ok:boolean, missing:string[], degraded:string[], reason:string|null}}
 */
export function validateAdapter(adapter) {
  if (!adapter || typeof adapter !== 'object')
    return { ok: false, missing: [...ADAPTER_MEMBERS], degraded: [...ADAPTER_OPTIONAL], reason: 'no editor adapter was supplied' }
  const missing = ADAPTER_MEMBERS.filter(k => typeof adapter[k] !== 'function')
  const degraded = ADAPTER_OPTIONAL.filter(k => typeof adapter[k] !== 'function')
  return {
    ok: missing.length === 0,
    missing,
    degraded,
    reason: missing.length ? `editor adapter is missing: ${missing.join(', ')}` : null,
  }
}

// ---------------------------------------------------------------------------
// Lifecycle state machine (pure — this is the part the tests drive directly)
// ---------------------------------------------------------------------------

export const HOST_STATES = ['idle', 'loading', 'ready', 'saving', 'reloading', 'error', 'disposed']

/**
 * Pure transition. Given the current lifecycle and an event, return the next lifecycle, the effect the
 * caller should run, and — when a transition is refused — the reason, so the UI can say why a click
 * did nothing instead of appearing broken.
 *
 * @param {{status:string, dirty?:boolean, generation?:number, reason?:string|null}} state
 * @param {{type:string, [k:string]:any}} event
 * @returns {{status:string, dirty:boolean, generation:number, reason:string|null, effect:string|null, refused:boolean}}
 */
export function nextHostState(state, event) {
  const cur = state && typeof state === 'object' ? state : {}
  const status = HOST_STATES.includes(cur.status) ? cur.status : 'idle'
  const dirty = cur.dirty === true
  const generation = Number.isFinite(cur.generation) ? cur.generation : 0
  const type = event && typeof event === 'object' ? String(event.type) : ''

  const at = (next, effect, extra = {}) =>
    ({ status: next, dirty, generation, reason: null, effect: effect || null, refused: false, ...extra })
  const refuse = reason => ({ status, dirty, generation, reason, effect: null, refused: true })

  // Disposed is terminal. A late promise resolving into a closed tab must not resurrect it — that is how
  // a stale file ends up rendered under a filename the user already navigated away from.
  if (status === 'disposed') return refuse('this viewer was closed')

  switch (type) {
    case 'dispose':
      return at('disposed', 'destroy', { dirty: false })

    case 'load':
      if (status === 'saving') return refuse('a save is in flight — loading now would race it')
      return at('loading', 'read')

    case 'loaded':
      if (status !== 'loading' && status !== 'reloading') return refuse(`nothing was loading (status: ${status})`)
      // `applyContent` pushes straight into the editor. Deliberately not into React state — see header.
      return at('ready', 'applyContent', { dirty: false })

    case 'loadFailed':
      if (status !== 'loading' && status !== 'reloading') return refuse(`nothing was loading (status: ${status})`)
      return { status: 'error', dirty, generation, reason: event.reason || 'load failed for an unstated reason', effect: null, refused: false }

    case 'edit':
      if (status !== 'ready') return refuse(`the editor is not ready (status: ${status})`)
      return at('ready', null, { dirty: true })

    case 'save':
      if (status === 'saving') return refuse('a save is already in flight')
      if (status !== 'ready') return refuse(`cannot save from status: ${status}`)
      // The generation bumps at save *issue* time, not completion: the watcher can fire before the
      // write promise resolves, and the echo check needs the new generation to already exist.
      return at('saving', 'write', { generation: generation + 1 })

    case 'saved':
      if (status !== 'saving') return refuse(`no save was in flight (status: ${status})`)
      return at('ready', null, { dirty: false })

    case 'saveFailed':
      if (status !== 'saving') return refuse(`no save was in flight (status: ${status})`)
      // Stay dirty. Clearing the dirty flag on a failed write tells the user their work is safe on disk
      // when it is not — the worst lie this state machine could tell.
      return { status: 'error', dirty: true, generation, reason: event.reason || 'save failed for an unstated reason', effect: null, refused: false }

    case 'externalChange':
      if (status === 'saving') return refuse('a save is in flight — the reload is deferred until it settles')
      if (dirty) return refuse('the file changed on disk but the buffer has unsaved edits — the user must choose')
      return at('reloading', 'read')

    case 'retry':
      if (status !== 'error') return refuse(`nothing to retry (status: ${status})`)
      return at('loading', 'read')

    default:
      return refuse(`unknown lifecycle event: ${type || '(none)'}`)
  }
}

// ---------------------------------------------------------------------------
// Echo detection
// ---------------------------------------------------------------------------
//
// The problem: we write the file, the watcher sees the write, we reload, which wipes whatever the user
// typed in the meantime. So the host must ignore watcher events its own saves caused.
//
// The naive fix — "is the file's content equal to what I just wrote?" — is wrong. A format-on-save hook
// (prettier, gofmt, a lint --fix, an editorconfig trailing-newline rule) rewrites the file immediately
// after our write, so the bytes on disk differ from the bytes we sent. Content comparison then calls a
// formatter echo an external change and reloads over the user's next keystrokes. Same failure for
// mtime+size captured at write time: the formatter's rewrite has a different mtime and usually a
// different size.
//
// What identity do we ACTUALLY have?
//   1. A monotonic write generation we control. We know a write was issued and when.
//   2. The (mtimeMs, size) the filesystem reported for OUR write, if the save adapter returns a stat.
//
// So the rule is layered:
//   * Exact stat match against an outstanding receipt → 'echo', certain.
//   * Content match against the bytes we wrote → 'echo', certain.
//   * Otherwise, inside the settle window after our write → 'echo', attributed to a save-time rewrite.
//     This is a heuristic and we mark it `certain: false` so the UI can show a quiet "reloaded after
//     format-on-save" note rather than pretending nothing happened.
//   * Outside the window → 'external'.
//
// RESIDUAL CASE WE CANNOT CATCH: a genuine third-party write (a teammate's `git checkout`, a codegen
// step, another editor) that lands inside the settle window of one of our own saves is byte-for-byte
// indistinguishable from a formatter rewriting our save. We will call it an echo and not reload. The
// window is deliberately short (default 1500ms) to shrink that hole, and `certain: false` is surfaced
// so the user has a thread to pull if the file "looks stale". There is no local-filesystem signal that
// closes this gap — resolving it needs the writer's identity, which inotify/FSEvents do not carry.

export const ECHO_SETTLE_MS = 1500

/** A receipt the host stores at write time. `stat` may be null — unknown is a value, not zero. */
export function makeWriteReceipt({ generation, at, content, stat = null }) {
  return {
    generation,
    at: Number.isFinite(at) ? at : 0,
    content: typeof content === 'string' ? content : null,
    stat: stat && Number.isFinite(stat.mtimeMs) && Number.isFinite(stat.size) ? { mtimeMs: stat.mtimeMs, size: stat.size } : null,
  }
}

/**
 * @param {Array} receipts outstanding write receipts (newest last)
 * @param {{at?:number, stat?:{mtimeMs:number,size:number}|null, content?:string|null}} event
 * @param {{settleMs?:number, now?:number}} opts
 * @returns {{verdict:'echo'|'external', certain:boolean, reason:string, receiptGeneration:number|null}}
 */
export function classifyWatchEvent(receipts, event, opts = {}) {
  // Drop malformed entries up front — a null in this list must not take out the chat/editor render path.
  const list = (Array.isArray(receipts) ? receipts : []).filter(r => r && typeof r === 'object')
  const ev = event && typeof event === 'object' ? event : {}
  const settleMs = Number.isFinite(opts.settleMs) ? opts.settleMs : ECHO_SETTLE_MS
  const now = Number.isFinite(opts.now) ? opts.now : (Number.isFinite(ev.at) ? ev.at : 0)

  if (!list.length)
    return { verdict: 'external', certain: true, reason: 'no write of ours is outstanding, so this change came from somewhere else', receiptGeneration: null }

  // Newest receipt first — a rapid save/save/watch burst should be attributed to the latest write.
  for (let i = list.length - 1; i >= 0; i--) {
    const r = list[i]
    if (r.stat && ev.stat && Number.isFinite(ev.stat.mtimeMs) && r.stat.mtimeMs === ev.stat.mtimeMs && r.stat.size === ev.stat.size)
      return { verdict: 'echo', certain: true, reason: `matches the mtime+size the filesystem reported for our write #${r.generation}`, receiptGeneration: r.generation }
    if (r.content !== null && typeof ev.content === 'string' && r.content === ev.content)
      return { verdict: 'echo', certain: true, reason: `file contents are byte-identical to our write #${r.generation}`, receiptGeneration: r.generation }
  }

  const newest = list[list.length - 1]
  if (now - newest.at <= settleMs)
    return {
      verdict: 'echo',
      certain: false,
      reason: `arrived ${Math.max(0, now - newest.at)}ms after our write #${newest.generation} but with different bytes — attributed to a save-time rewrite (formatter/lint fix). A genuine outside write in this window is indistinguishable from this and would also be suppressed.`,
      receiptGeneration: newest.generation,
    }

  return { verdict: 'external', certain: true, reason: `arrived ${now - newest.at}ms after our last write, past the ${settleMs}ms settle window`, receiptGeneration: null }
}

/** Drop receipts that can no longer explain an incoming event, so the list cannot grow forever. */
export function pruneReceipts(receipts, now, settleMs = ECHO_SETTLE_MS) {
  const list = (Array.isArray(receipts) ? receipts : []).filter(r => r && typeof r === 'object')
  // Keep the newest unconditionally: it is the one the settle-window rule reads.
  return list.filter((r, i) => i === list.length - 1 || now - r.at <= settleMs * 4)
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Build the host object every viewer talks to. `io` supplies the side effects (read/write/stat/now) so
 * the whole thing is testable without a filesystem or a browser.
 *
 * Contract members returned: load, save, applyContent, getCurrentContent, watch, diff, theme
 * (plus getState / subscribe / dispose for the React shell).
 *
 * Nothing here throws. Every failure path returns `{ok:false, reason}`.
 */
export function createEditorHost({ adapter, io = {}, path = null, settleMs = ECHO_SETTLE_MS, onChange = null } = {}) {
  const check = validateAdapter(adapter)
  const now = () => (typeof io.now === 'function' ? io.now() : Date.now())

  let state = { status: check.ok ? 'idle' : 'error', dirty: false, generation: 0, reason: check.reason }
  let baseline = null           // last known on-disk text — the diff baseline. null means "unknown".
  let receipts = []
  let themeName = 'dark'
  const notices = []            // every suppressed/capped/degraded thing the user is owed
  const listeners = new Set()

  const note = (level, text) => {
    notices.push({ level, text, at: now() })
    // Bounded so a watcher loop cannot grow this without limit; the cap itself is announced.
    if (notices.length > 50) { notices.splice(0, notices.length - 50); notices[0] = { level: 'warn', text: 'older notices dropped (50 kept)', at: now() } }
  }
  const emit = () => { for (const l of listeners) { try { l(snapshot()) } catch { /* a bad subscriber must not break the host */ } }; if (onChange) { try { onChange(snapshot()) } catch {} } }

  const apply = ev => {
    const next = nextHostState(state, ev)
    if (next.refused) return { ok: false, reason: next.reason, effect: null }
    state = { status: next.status, dirty: next.dirty, generation: next.generation, reason: next.reason }
    emit()
    return { ok: true, reason: next.reason, effect: next.effect }
  }

  const snapshot = () => ({
    path,
    status: state.status,
    dirty: state.dirty,
    generation: state.generation,
    reason: state.reason,
    theme: themeName,
    hasBaseline: baseline !== null,
    adapter: check,
    notices: notices.slice(),
  })

  async function doRead(ev) {
    const step = apply({ type: ev })
    if (!step.ok) return { ok: false, content: null, reason: step.reason }
    if (typeof io.read !== 'function') {
      apply({ type: 'loadFailed', reason: 'no read() was supplied to this host' })
      return { ok: false, content: null, reason: 'no read() was supplied to this host' }
    }
    let res
    try { res = await io.read(path) } catch (e) { res = { ok: false, reason: e?.message || String(e) } }
    // Accept both `{ok, content}` and a bare string, so simple adapters stay simple.
    const content = typeof res === 'string' ? res : res && typeof res.content === 'string' ? res.content : null
    if (content === null) {
      const reason = (res && res.reason) || 'read returned no content and no reason'
      apply({ type: 'loadFailed', reason })
      return { ok: false, content: null, reason }
    }
    baseline = content
    const ok = apply({ type: 'loaded' })
    if (ok.effect === 'applyContent' && check.ok) {
      try { adapter.applyContent(content) } catch (e) { note('warn', `editor rejected the content push: ${e?.message || e}`) }
    }
    return { ok: true, content, reason: null }
  }

  return {
    // --- contract ---------------------------------------------------------
    load: () => doRead('load'),

    /** Push text into the editor. Never round-trips through React state — see the header comment. */
    applyContent(text) {
      if (!check.ok) return { ok: false, reason: check.reason }
      if (typeof text !== 'string') return { ok: false, reason: 'applyContent needs a string; got ' + (text === null ? 'null' : typeof text) }
      try { adapter.applyContent(text); return { ok: true, reason: null } }
      catch (e) { return { ok: false, reason: `editor rejected applyContent: ${e?.message || e}` } }
    },

    /** Pull the live buffer. `content: null` + reason when the editor cannot answer — never ''. */
    getCurrentContent() {
      if (!check.ok) return { content: null, reason: check.reason }
      try {
        const v = adapter.getCurrentContent()
        if (typeof v !== 'string') return { content: null, reason: 'the editor returned no buffer (it may not be mounted yet)' }
        return { content: v, reason: null }
      } catch (e) { return { content: null, reason: `editor threw reading its buffer: ${e?.message || e}` } }
    },

    async save() {
      const cur = this.getCurrentContent()
      if (cur.content === null) return { ok: false, reason: cur.reason }
      const step = apply({ type: 'save' })
      if (!step.ok) return { ok: false, reason: step.reason }
      const at = now()
      if (typeof io.write !== 'function') {
        apply({ type: 'saveFailed', reason: 'no write() was supplied to this host' })
        return { ok: false, reason: 'no write() was supplied to this host' }
      }
      let res
      try { res = await io.write(path, cur.content) } catch (e) { res = { ok: false, reason: e?.message || String(e) } }
      if (res && res.ok === false) {
        const reason = res.reason || 'write failed for an unstated reason'
        apply({ type: 'saveFailed', reason })
        return { ok: false, reason }
      }
      receipts = pruneReceipts(
        [...receipts, makeWriteReceipt({ generation: state.generation, at, content: cur.content, stat: (res && res.stat) || null })],
        at, settleMs)
      if (!(res && res.stat)) note('info', 'the save returned no mtime/size, so echo suppression for this write falls back to the timing heuristic')
      baseline = cur.content
      apply({ type: 'saved' })
      return { ok: true, reason: null, generation: state.generation }
    },

    /**
     * Feed a watcher event in. Returns what the host decided and why — the caller should surface
     * `reason` when `certain` is false, so a suppressed reload is visible rather than mysterious.
     */
    async watch(event) {
      const verdict = classifyWatchEvent(receipts, event, { settleMs, now: (event && event.at) || now() })
      if (verdict.verdict === 'echo') {
        if (!verdict.certain) note('info', `ignored a file-change event: ${verdict.reason}`)
        return { reloaded: false, ...verdict }
      }
      const step = nextHostState(state, { type: 'externalChange' })
      if (step.refused) {
        note('warn', `the file changed on disk but was not reloaded: ${step.reason}`)
        return { reloaded: false, ...verdict, blocked: step.reason }
      }
      const r = await doRead('externalChange')
      return { reloaded: r.ok, ...verdict, loadReason: r.reason }
    },

    /** Diff of the on-disk baseline against the live buffer. Both sides may be unknown; both say so. */
    diff(opts) {
      const cur = this.getCurrentContent()
      if (cur.content === null) return { ...computeLineDiff(baseline, null), reason: cur.reason }
      return computeLineDiff(baseline, cur.content, opts)
    },

    /** Theme is host-level so every viewer flips together. Adapters without setTheme are reported. */
    theme(name) {
      if (name === undefined) return { theme: themeName, applied: true, reason: null }
      if (typeof name !== 'string' || !name) return { theme: themeName, applied: false, reason: 'theme name must be a non-empty string' }
      themeName = name
      if (typeof adapter?.setTheme !== 'function') {
        note('info', `theme set to "${name}" but this viewer has no setTheme — its colours will not follow`)
        return { theme: themeName, applied: false, reason: 'this viewer does not implement setTheme' }
      }
      try { adapter.setTheme(name); emit(); return { theme: themeName, applied: true, reason: null } }
      catch (e) { return { theme: themeName, applied: false, reason: `editor threw on setTheme: ${e?.message || e}` } }
    },

    // --- shell helpers ----------------------------------------------------
    markDirty: () => apply({ type: 'edit' }),
    retry: () => doRead('retry'),
    getState: snapshot,
    getBaseline: () => baseline,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn) },
    dispose() {
      apply({ type: 'dispose' })
      listeners.clear()
      receipts = []
      if (typeof adapter?.destroy === 'function') { try { adapter.destroy() } catch { /* teardown must not throw into unmount */ } }
    },
  }
}
