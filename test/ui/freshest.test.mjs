import test from 'node:test'
import assert from 'node:assert/strict'
import { freshest } from '../../src/lib/hooks.js'

// What this guards, which was a real bug and not a hypothetical one: the runs pane issued an
// unfiltered fetch and then a scoped one, the unfiltered response arrived SECOND, and the pane
// rendered every project's runs under a filter pill that still read "proj: loushai". Nothing threw
// and nothing looked wrong — the rows were just from somewhere else. That is the failure mode this
// exists to make impossible, so the test that matters is the out-of-order one.

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }

test('a response that is no longer the newest never lands', async () => {
  const applied = []
  const fresh = freshest()
  const first = deferred()
  const second = deferred()

  const a = fresh(first.promise, v => applied.push(v))
  const b = fresh(second.promise, v => applied.push(v))

  // Out of order on purpose: the STALE request settles last, which is the case that used to win.
  second.resolve('scoped')
  first.resolve('unfiltered')
  await Promise.all([a, b])

  assert.deepEqual(applied, ['scoped'], 'only the newest request may apply its result')
})

test('in-order responses still apply, one after another', async () => {
  const applied = []
  const fresh = freshest()
  await fresh(Promise.resolve('one'), v => applied.push(v))
  await fresh(Promise.resolve('two'), v => applied.push(v))
  assert.deepEqual(applied, ['one', 'two'])
})

test('the promise is passed through, so callers keep their .then and .catch', async () => {
  const fresh = freshest()
  assert.equal(await fresh(Promise.resolve(42), () => {}), 42)
  await assert.rejects(fresh(Promise.reject(new Error('boom')), () => {}), /boom/)
})

test('each instance counts independently — one pane cannot cancel another pane', async () => {
  const seen = []
  const paneA = freshest()
  const paneB = freshest()
  const slow = deferred()
  const a = paneA(slow.promise, v => seen.push('a:' + v))
  const b = paneB(Promise.resolve('now'), v => seen.push('b:' + v))
  slow.resolve('later')
  await Promise.all([a, b])
  assert.deepEqual(seen.sort(), ['a:later', 'b:now'])
})
