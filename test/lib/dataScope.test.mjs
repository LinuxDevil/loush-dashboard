// test/lib/dataScope.test.mjs — the global data-scope store.
// The load-bearing test is the stale one: a slow response issued under the OLD scope must be
// DISCARDED, because rendering it puts one project's numbers under another project's heading.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  SCOPE_KEYS, normalizeScope, describeScope, applyScopeToUrl, createScopeStore, dataScope,
} from '../../src/lib/dataScope.js'

const deferred = () => { let resolve, reject; const promise = new Promise((res, rej) => { resolve = res; reject = rej }); return { promise, resolve, reject } }

// ---------------------------------------------------------------------------
// normalisation — an unusable scope value is null, never coerced
// ---------------------------------------------------------------------------

test('scope values are trimmed strings; anything else is rejected WITH a reason, not coerced', () => {
  const r = normalizeScope({ project: '  /repo/a  ', source: 42, nonsense: 'x' })
  assert.equal(r.scope.project, '/repo/a')
  assert.equal(r.scope.source, null)                       // NOT '42' — a coerced scope reads as real
  assert.ok(r.rejected.some(x => x.key === 'source' && /left unset \(global\)/.test(x.reason)))
  assert.ok(r.rejected.some(x => x.key === 'nonsense' && /not a scope dimension/.test(x.reason)))
  assert.deepEqual(normalizeScope(null).scope, { project: null, source: null })
  assert.ok(normalizeScope('nope').rejected.some(x => x.key === '*'))
  assert.equal(normalizeScope({ project: '   ' }).scope.project, null)
})

test('the active scope is always describable — an empty qualifier is how invisible filters happen', () => {
  assert.equal(describeScope({ project: null, source: null }), 'all projects and sources (no filter)')
  assert.equal(describeScope({ project: '/home/me/dash' }), 'filtered to project dash')
  assert.match(describeScope({ project: '/x/a', source: 'jira' }), /project a · source jira/)
})

// ---------------------------------------------------------------------------
// query-param injection
// ---------------------------------------------------------------------------

test('the scope is injected into the query string and the injection is reported', () => {
  const r = applyScopeToUrl('/api/overview', { project: '/repo/a b', source: 'jira' })
  assert.equal(r.url, '/api/overview?project=%2Frepo%2Fa%20b&source=jira')
  assert.deepEqual(r.injected, { project: '/repo/a b', source: 'jira' })
  const q = applyScopeToUrl('/api/board?days=7', { project: '/repo/a' })
  assert.equal(q.url, '/api/board?days=7&project=%2Frepo%2Fa')
  assert.deepEqual(applyScopeToUrl('/api/x', { project: null, source: null }).injected, {})
})

test("an explicit param in the URL wins, and the skip is reported rather than silent", () => {
  const r = applyScopeToUrl('/api/board?project=%2Fexplicit', { project: '/repo/global' })
  assert.equal(r.url, '/api/board?project=%2Fexplicit')
  assert.deepEqual(r.injected, {})
  assert.match(r.skipped[0].reason, /caller's value wins/)
})

test('an endpoint that does not honour a param is REPORTED as wider than its heading', () => {
  const r = applyScopeToUrl('/api/usage', { project: '/repo/a', source: 'jira' }, { scopedParams: ['project'] })
  assert.deepEqual(r.unenforced, ['source'])
  assert.match(r.unenforcedReason, /WIDER than the heading implies/)
  const known = applyScopeToUrl('/api/board', { project: '/repo/a' }, { scopedParams: ['project'] })
  assert.deepEqual(known.unenforced, [])
  assert.equal(known.unenforcedReason, null)
  // Unknown is a value: with nothing declared, `unenforced` is null ("we do not know"), not [].
  const unknown = applyScopeToUrl('/api/board', { project: '/repo/a' })
  assert.equal(unknown.unenforced, null)
  assert.match(unknown.unenforcedReason, /unknown/)
})

// ---------------------------------------------------------------------------
// the store
// ---------------------------------------------------------------------------

test('set reports exactly what changed and bumps the generation', () => {
  const s = createScopeStore({ project: '/repo/a' })
  assert.equal(s.get().generation, 1)
  assert.equal(s.get().isFiltered, true)
  const r = s.set({ project: '/repo/b' })
  assert.deepEqual(r.changed, [{ key: 'project', from: '/repo/a', to: '/repo/b' }])
  assert.equal(r.generation, 2)
  assert.match(r.reason, /generation 1 will be discarded/)
  assert.equal(s.get().project, '/repo/b')
})

test('a set that changes nothing does NOT bump the generation', () => {
  const s = createScopeStore({ project: '/repo/a' })
  const r = s.set({ project: '/repo/a' })
  assert.deepEqual(r.changed, [])
  assert.equal(r.generation, 1)
  assert.match(r.reason, /in-flight requests stay valid/)
})

test('clear() returns to the global scope and says so', () => {
  const s = createScopeStore({ project: '/repo/a', source: 'jira' })
  const r = s.clear()
  assert.equal(r.changed.length, 2)
  assert.equal(s.get().isFiltered, false)
  assert.equal(s.get().describe, 'all projects and sources (no filter)')
})

test('the store never throws on a malformed patch and leaves the scope untouched', () => {
  const s = createScopeStore({ project: '/repo/a' })
  for (const bad of ['x', 42, []]) {
    const r = s.set(bad)
    assert.deepEqual(r.changed, [])
    assert.match(r.rejected[0].reason, /left unchanged/)
  }
  assert.equal(s.get().project, '/repo/a')
  assert.equal(s.get().generation, 1)
})

// ---------------------------------------------------------------------------
// listeners
// ---------------------------------------------------------------------------

test('subscribe/unsubscribe leaks nothing, and unsubscribe is idempotent', () => {
  const s = createScopeStore(null)
  const seen = []
  const off1 = s.subscribe(x => seen.push(x.project))
  const off2 = s.subscribe(() => {})
  assert.equal(s.listenerCount(), 2)
  s.set({ project: '/repo/a' })
  assert.deepEqual(seen, ['/repo/a'])
  off1(); off1(); off1()                                   // React StrictMode double-cleanup
  assert.equal(s.listenerCount(), 1)
  s.set({ project: '/repo/b' })
  assert.deepEqual(seen, ['/repo/a'])                      // no notification after unsubscribe
  off2()
  assert.equal(s.listenerCount(), 0)
  assert.equal(typeof s.subscribe('not a function'), 'function')  // never throws at a wiring caller
})

test('a listener that unsubscribes itself does not cause the NEXT listener to be skipped', () => {
  const s = createScopeStore(null)
  const seen = []
  const off1 = s.subscribe(() => { seen.push('one'); off1() })
  s.subscribe(() => seen.push('two'))
  s.set({ project: '/repo/a' })
  assert.deepEqual(seen, ['one', 'two'])
})

test('a throwing listener is isolated — everyone else still learns the scope changed', () => {
  const errs = []
  const s = createScopeStore(null, { onListenerError: e => errs.push(e.message) })
  s.subscribe(() => { throw new Error('boom') })
  const seen = []
  s.subscribe(x => seen.push(x.generation))
  s.set({ project: '/repo/a' })
  assert.deepEqual(seen, [2])
  assert.deepEqual(errs, ['boom'])
})

// ---------------------------------------------------------------------------
// generation-token cancellation — the reason this file exists
// ---------------------------------------------------------------------------

test('a response from the OLD scope that lands after a scope change is DISCARDED', async () => {
  const slow = deferred()
  const urls = []
  const s = createScopeStore({ project: '/repo/A' }, {
    fetchImpl: url => { urls.push(url); return url.includes('A') ? slow.promise : Promise.resolve({ total: 999 }) },
  })

  const inflight = s.fetch('/api/overview')         // issued under project A (generation 1)
  s.set({ project: '/repo/B' })                     // user switches to B while A is in flight
  const fast = await s.fetch('/api/overview')       // B answers first
  assert.equal(fast.ok, true)
  assert.deepEqual(fast.data, { total: 999 })
  assert.equal(fast.scope.project, '/repo/B')

  slow.resolve({ total: 1 })                        // …and NOW A's slow response arrives
  const stale = await inflight
  assert.equal(stale.ok, false)
  assert.equal(stale.stale, true)
  assert.equal(stale.data, null)                    // there is literally nothing to setState with
  assert.equal(stale.issuedGeneration, 1)
  assert.equal(stale.currentGeneration, 2)
  assert.equal(stale.issuedScope.project, '/repo/A')
  assert.equal(stale.currentScope.project, '/repo/B')
  assert.match(stale.reason, /project A/)           // names BOTH scopes
  assert.match(stale.reason, /project B/)
  assert.match(stale.reason, /previous scope's numbers under the current scope's heading/)
  assert.deepEqual(urls, ['/api/overview?project=%2Frepo%2FA', '/api/overview?project=%2Frepo%2FB'])
})

test('a response that lands while its generation is still current is delivered with its scope attached', async () => {
  const s = createScopeStore({ project: '/repo/A' }, { fetchImpl: async () => ({ n: 1 }) })
  const r = await s.fetch('/api/overview', undefined, { scopedParams: ['project'] })
  assert.equal(r.ok, true)
  assert.equal(r.stale, false)
  assert.deepEqual(r.data, { n: 1 })
  assert.equal(r.generation, 1)
  assert.deepEqual(r.scope, { project: '/repo/A', source: null })
  // The qualifier travels WITH the data so no component can render the number bare.
  assert.equal(r.describe, 'filtered to project A')
  assert.deepEqual(r.unenforced, [])
})

test('a scope change back to the original value still discards the in-flight response', async () => {
  // A→B→A is the trap: the scope LOOKS unchanged when the response lands, but the request was issued
  // before two mutations and there is no guarantee it reflects the current server-side cache state.
  const slow = deferred()
  const s = createScopeStore({ project: '/repo/A' }, { fetchImpl: () => slow.promise })
  const inflight = s.fetch('/api/overview')
  s.set({ project: '/repo/B' })
  s.set({ project: '/repo/A' })
  slow.resolve({ n: 1 })
  const r = await inflight
  assert.equal(r.stale, true)
  assert.equal(r.issuedGeneration, 1)
  assert.equal(r.currentGeneration, 3)
})

test('a failed request reports the failure and never masquerades as data', async () => {
  const s = createScopeStore(null, { fetchImpl: async () => { throw new Error('network down') } })
  const r = await s.fetch('/api/overview')
  assert.equal(r.ok, false)
  assert.equal(r.stale, false)
  assert.equal(r.data, null)
  assert.match(r.reason, /network down/)
})

test('a failure that arrives after a scope change is reported as stale, not as an error to show', async () => {
  const slow = deferred()
  const s = createScopeStore({ project: '/repo/A' }, { fetchImpl: () => slow.promise })
  const inflight = s.fetch('/api/overview')
  s.set({ project: '/repo/B' })
  slow.reject(new Error('aborted'))
  const r = await inflight.catch(e => ({ threw: e }))
  assert.equal(r.threw, undefined, 'fetch must never reject at the caller')
  assert.equal(r.stale, true)
  assert.equal(r.data, null)
})

test('with no fetch implementation the store says so instead of throwing', async () => {
  const s = createScopeStore(null, { fetchImpl: null })
  const saved = globalThis.fetch
  delete globalThis.fetch
  try {
    const r = await s.fetch('/api/overview')
    assert.equal(r.ok, false)
    assert.equal(r.error, 'no_fetch')
  } finally { if (saved) globalThis.fetch = saved }
})

test('the shared app-wide instance starts global and exposes the same dimensions', () => {
  assert.deepEqual(SCOPE_KEYS, ['project', 'source'])
  assert.equal(dataScope.get().isFiltered, false)
  assert.equal(dataScope.get().describe, 'all projects and sources (no filter)')
})
