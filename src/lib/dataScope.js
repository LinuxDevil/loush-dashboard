// src/lib/dataScope.js — one client-side store that narrows every aggregate query by project/source,
// injects the scope into the fetch wrapper, and refuses to let a stale answer land.
//
// THE FAILURE THIS EXISTS TO PREVENT
// Aggregate endpoints here are slow and TTL-cached (see the `respCache` table in server/index.mjs:
// /api/overview 300s, /api/forensics 600s). Switch the scope from project A to project B while A's
// request is still in flight and the A response resolves LAST — React setState fires, and B's
// heading now sits above A's numbers. Nothing errors. Nothing looks wrong. The number is simply from
// a different project, which is the worst possible failure mode for a dashboard: confidently wrong.
// So every scope change bumps a generation counter, every request carries the generation it was
// issued under, and a response whose generation is no longer current is DISCARDED with a stated
// reason rather than returned to the caller.
//
// THE SECOND FAILURE: an invisible filter. A filtered aggregate that renders like a global one is a
// wrong number even when the fetch was perfect. `describe()` and `isFiltered` exist so the UI can
// always state, in the heading, exactly what is being counted — and every scoped result carries the
// scope it was fetched under so a component can never render a number without its qualifier.
//
// Framework-free and DOM-free on purpose: it must be unit-testable under `node --test`, and the
// generation logic is the part that has to be tested.

export const SCOPE_KEYS = ['project', 'source']
// Query params the scope injects. Named to match what the express routes already read
// (`req.query.project`); `source` is additive and ignored by routes that do not know it — which is
// itself worth stating: a param a route ignores means the response is NOT actually narrowed, so
// `unenforced` below reports which keys the caller has no server-side guarantee for.
export const SCOPE_PARAM = { project: 'project', source: 'source' }

const isNonEmptyString = v => typeof v === 'string' && v.trim().length > 0

/**
 * Normalise a scope patch. Anything unusable becomes null WITH a reason rather than being coerced to
 * a plausible-looking value — a scope silently coerced to "" reads downstream as "global", and the
 * user is then shown every project's numbers under one project's name.
 */
export function normalizeScope(input) {
  const scope = { project: null, source: null }
  const rejected = []
  if (input == null) return { scope, rejected }
  if (typeof input !== 'object' || Array.isArray(input)) {
    rejected.push({ key: '*', reason: `scope must be an object, got ${Array.isArray(input) ? 'array' : typeof input} — scope left global rather than guessed at` })
    return { scope, rejected }
  }
  for (const k of SCOPE_KEYS) {
    const v = input[k]
    if (v === undefined || v === null) continue
    if (isNonEmptyString(v)) { scope[k] = v.trim(); continue }
    rejected.push({ key: k, value: typeof v === 'object' ? '[object]' : String(v).slice(0, 60), reason: `${k} must be a non-empty string; got ${typeof v} — this key was left unset (global) instead of being coerced` })
  }
  for (const k of Object.keys(input)) if (!SCOPE_KEYS.includes(k)) rejected.push({ key: k, reason: `"${k}" is not a scope dimension and was ignored — dimensions are: ${SCOPE_KEYS.join(', ')}` })
  return { scope, rejected }
}

/** Human sentence for a heading. Never returns "" — an empty qualifier is how invisible filters happen. */
export function describeScope(scope) {
  const parts = []
  if (scope?.project) parts.push(`project ${shortProject(scope.project)}`)
  if (scope?.source) parts.push(`source ${scope.source}`)
  return parts.length ? `filtered to ${parts.join(' · ')}` : 'all projects and sources (no filter)'
}
const shortProject = p => (typeof p === 'string' && p.includes('/') ? p.split('/').filter(Boolean).pop() : String(p))

/** Inject the scope into a URL's query string. Existing params win — an explicit call is not overruled. */
export function applyScopeToUrl(url, scope, opts = {}) {
  const injected = {}
  const skipped = []
  let out = String(url ?? '')
  const has = name => new RegExp(`[?&]${name}=`).test(out)
  for (const k of SCOPE_KEYS) {
    const v = scope?.[k]
    if (!isNonEmptyString(v)) continue
    const param = SCOPE_PARAM[k]
    if (has(param)) { skipped.push({ key: k, reason: `the URL already sets ${param}= explicitly — the caller's value wins and the global scope was NOT applied to it` }); continue }
    out += (out.includes('?') ? '&' : '?') + param + '=' + encodeURIComponent(v)
    injected[k] = v
  }
  // Which routes actually honour which param is knowledge only the caller has. Reporting the
  // difference beats assuming: a param the server drops means an "unfiltered" number under a
  // filtered heading, which is the same lie as a stale response.
  const scoped = Array.isArray(opts.scopedParams) ? opts.scopedParams : null
  const unenforced = scoped ? Object.keys(injected).filter(k => !scoped.includes(SCOPE_PARAM[k])) : null
  return {
    url: out,
    injected,
    skipped,
    unenforced,   // null = UNKNOWN (not "none"): nobody told us what this endpoint honours
    unenforcedReason: unenforced === null
      ? 'no per-endpoint scope support was declared, so whether the server actually narrows by these params is unknown'
      : unenforced.length
        ? `this endpoint does not narrow by ${unenforced.join(', ')} — the returned aggregate is WIDER than the heading implies`
        : null,
  }
}

// ---------------------------------------------------------------------------
// the store
// ---------------------------------------------------------------------------

export function createScopeStore(initial, opts = {}) {
  let { scope } = normalizeScope(initial)
  let generation = 1
  const listeners = new Set()

  const snapshot = () => ({
    ...scope,
    generation,
    isFiltered: SCOPE_KEYS.some(k => scope[k] != null),
    describe: describeScope(scope),
  })

  const emit = () => {
    const snap = snapshot()
    // Iterate a COPY: a listener that unsubscribes itself (the normal React cleanup pattern) mutates
    // the set mid-iteration, and the next listener would be skipped for that one notification only —
    // a bug that shows up as one stale panel, once, and is unreproducible.
    for (const fn of [...listeners]) {
      // A throwing listener must not prevent the others from learning the scope changed; a component
      // left on the old scope is exactly the cross-project mixup this file exists to prevent.
      try { fn(snap) } catch (e) { (opts.onListenerError || defaultListenerError)(e) }
    }
  }

  return {
    get: () => snapshot(),
    /** The current generation token. Hold it across an await and hand it back to `isCurrent`. */
    token: () => generation,
    isCurrent: token => token === generation,

    /**
     * Merge a patch. Returns what actually changed plus anything rejected. A set that changes nothing
     * does NOT bump the generation: a needless bump cancels in-flight requests that were still valid,
     * and the user watches loaded panels blank out for no reason.
     */
    set(patch) {
      const { scope: next, rejected } = normalizeScope({ ...scope, ...(patch && typeof patch === 'object' && !Array.isArray(patch) ? patch : {}) })
      if (patch != null && (typeof patch !== 'object' || Array.isArray(patch)))
        return { changed: [], generation, rejected: [{ key: '*', reason: `set() expects an object patch, got ${Array.isArray(patch) ? 'array' : typeof patch} — the scope was left unchanged` }], scope: snapshot() }
      const changed = SCOPE_KEYS.filter(k => scope[k] !== next[k]).map(k => ({ key: k, from: scope[k], to: next[k] }))
      if (!changed.length) return { changed: [], generation, rejected, scope: snapshot(), reason: 'the scope already held those values — the generation was NOT bumped, so in-flight requests stay valid' }
      scope = next
      generation++
      const snap = snapshot()
      emit()
      return { changed, generation, rejected, scope: snap, reason: `scope changed; generation ${generation} — any response issued under generation ${generation - 1} will be discarded as stale` }
    },
    clear() { return this.set({ project: null, source: null }) },

    subscribe(fn) {
      if (typeof fn !== 'function') return () => {} // never throw at a caller wiring up an effect
      listeners.add(fn)
      let done = false
      // Idempotent: React StrictMode runs cleanup twice, and a non-idempotent remove that also
      // decremented a counter would leave the store believing it still has a live subscriber.
      return () => { if (done) return; done = true; listeners.delete(fn) }
    },
    listenerCount: () => listeners.size,

    /**
     * Scoped fetch. Resolves to a RESULT ENVELOPE, never a bare payload:
     *   {ok:true,  data, scope, generation}
     *   {ok:false, stale:true, data:null, reason, issuedGeneration, currentGeneration}
     *   {ok:false, error, reason}
     * The stale case is the whole point — the caller cannot accidentally setState with another
     * project's numbers, because on a stale resolve there is no `data` to set.
     */
    async fetch(url, init, fetchOpts = {}) {
      const issued = generation
      const issuedScope = { ...scope }
      const applied = applyScopeToUrl(url, issuedScope, fetchOpts)
      const impl = fetchOpts.fetchImpl || opts.fetchImpl || (typeof globalThis !== 'undefined' ? globalThis.fetch : null)
      if (typeof impl !== 'function')
        return { ok: false, stale: false, data: null, error: 'no_fetch', reason: 'no fetch implementation is available in this environment — pass fetchImpl', url: applied.url, scope: issuedScope, generation: issued }
      let data = null, error = null
      try {
        data = await impl(applied.url, init)
      } catch (e) {
        error = e
      }
      if (issued !== generation)
        return {
          ok: false, stale: true, data: null, url: applied.url,
          issuedGeneration: issued, currentGeneration: generation,
          issuedScope, currentScope: { ...scope },
          error: null,
          // Name both scopes: "discarded" with no detail is indistinguishable from a dropped request.
          reason: `discarded a response issued under ${describeScope(issuedScope)} (generation ${issued}); the scope is now ${describeScope(scope)} (generation ${generation}). Rendering it would have shown the previous scope's numbers under the current scope's heading.`,
        }
      if (error)
        return { ok: false, stale: false, data: null, error: String(error?.message || error), reason: `the scoped request failed: ${String(error?.message || error)}`, url: applied.url, scope: issuedScope, generation: issued }
      return {
        ok: true, stale: false, data, error: null, url: applied.url,
        scope: issuedScope, generation: issued,
        injected: applied.injected,
        unenforced: applied.unenforced,
        // Travels with the data so no component can render the number without its qualifier.
        describe: describeScope(issuedScope),
        reason: null,
      }
    },
  }
}

const defaultListenerError = e => {
  // Console, not throw: swallowing entirely hides a broken subscriber forever.
  if (typeof console !== 'undefined' && console.warn) console.warn('[dataScope] a scope listener threw and was skipped:', e?.message || e)
}

/** The app-wide instance. Sections import this; tests build their own with createScopeStore(). */
export const dataScope = createScopeStore(null)
