// The blind property, swept across EVERY route rather than the two that were spot-checked.
//
// `compare.test.mjs` asserts that no model name reaches the client through `GET /api/compare/:id`
// and through the list. Those are the two obvious read paths and they were the two that were
// checked. This asserts the property as a property: for a comparison with no vote, NOTHING any
// route returns — success or error, at any status — may contain a model name, a per-pane cost, or a
// per-pane latency.
//
// Stated that way it survives a new route being added: a route that leaks will fail here without
// anyone remembering to think about blindness, which is the only kind of coverage worth having for
// an invariant that is one careless `res.json(rec)` away from being lost.
//
// The pane TEXT is exempt and blanked before the sweep, because it is the model's own words — a
// model that signs its answer has de-anonymised itself and no server-side check can undo that. That
// exemption is the reason the rest of the sweep has to be total.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'compare-blind-'))
process.env.HOME = TMP
process.env.USERPROFILE = TMP
const REPO = path.join(TMP, 'repo')
fs.mkdirSync(REPO, { recursive: true })

const { default: mountCompare } = await import('../../server/compare.mjs')

// Names chosen so a leak cannot hide in a substring, and costs/latencies far enough apart that
// serving either would identify the pane on its own.
const MODELS = ['zeta-opus-x1', 'zeta-sonnet-x2', 'zeta-haiku-x3']
const PROFILE = {
  'zeta-opus-x1': { cost: 0.987654, ms: 91_111, turns: 70_707 },
  'zeta-sonnet-x2': { cost: 0.123456, ms: 32_222, turns: 30_303 },
  // This one fails, and `runAgent`'s stderr names the model it was invoked with — the leak that
  // nearly shipped. It stays in the sweep so the error channel is covered at every status code.
  'zeta-haiku-x3': { error: 'Error: model `zeta-haiku-x3` is not available on this account' },
}
const runAgent = async ({ model }) => PROFILE[model].error
  ? { error: PROFILE[model].error }
  : { result: `an answer that never names its author`, ...PROFILE[model] }

function harness() {
  const routes = new Map()
  const app = {}
  for (const m of ['get', 'post', 'put', 'patch', 'delete']) app[m] = (p, h) => routes.set(m + ' ' + p, h)
  mountCompare(app, { runAgent })
  return async (method, urlPath, { query = {}, params = {}, body = {} } = {}) => {
    const h = routes.get(method + ' ' + urlPath)
    assert.ok(h, `no handler for ${method} ${urlPath}`)
    let status = 200, out
    const res = { status(c) { status = c; return this }, json(b) { out = b; return this } }
    await h({ query, params, body }, res)
    return { status, body: out }
  }
}
const call = harness()
process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }) } catch {} })

/** Everything that identifies a pane, as strings, minus the answer text. */
const SECRETS = [
  ...MODELS,
  ...Object.values(PROFILE).flatMap(p => [p.cost, p.ms, p.turns]).filter(v => v != null).map(String),
]

function assertBlind(where, payload) {
  const scrub = v => {
    if (Array.isArray(v)) return v.map(scrub)
    if (v && typeof v === 'object') {
      // `text` is the model's own words and `id` is random hex whose digits can collide with a
      // latency by chance — neither carries attribution, and both would make this flaky.
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, (k === 'text' || k === 'id') ? '' : scrub(x)]))
    }
    return v
  }
  const wire = JSON.stringify(scrub(payload) ?? null)
  for (const s of SECRETS) {
    assert.equal(wire.includes(s), false, `${where} leaked ${JSON.stringify(s)} before a vote:\n${wire}`)
  }
}

test('no route reveals a model, a cost or a latency before a vote', async () => {
  // create
  const create = await call('post', '/api/compare', { body: { cwd: REPO, prompt: 'compare these', models: MODELS } })
  assert.equal(create.status, 200)
  assertBlind('POST /api/compare', create.body)
  const id = create.body.id

  // read
  const read = await call('get', '/api/compare/:id', { params: { id } })
  assert.equal(read.status, 200)
  assert.equal(read.body.voted, false)
  assertBlind('GET /api/compare/:id', read.body)
  // …and the failure IS reported, so this is blindness rather than silence.
  assert.equal(read.body.panes.filter(p => p.failed).length, 1, 'the failed pane is still shown as failed')
  for (const p of read.body.panes) assert.equal(p.error, null)

  // list
  const list = await call('get', '/api/compare')
  assert.equal(list.status, 200)
  assertBlind('GET /api/compare', list.body)

  // vote, rejected — the 400 names the labels, and must not name the models
  const badVote = await call('post', '/api/compare/:id/vote', { params: { id }, body: { label: 'ZZ' } })
  assert.equal(badVote.status, 400)
  assertBlind('POST /api/compare/:id/vote (bad label)', badVote.body)

  // synthesize, refused
  const synth = await call('post', '/api/compare/:id/synthesize', { params: { id }, body: {} })
  assert.equal(synth.status, 409)
  assertBlind('POST /api/compare/:id/synthesize (pre-vote)', synth.body)

  // a synthesize that names a model in the REQUEST is still refused before a vote, so it cannot be
  // used as an oracle for "is this model in the comparison".
  const synthNamed = await call('post', '/api/compare/:id/synthesize', { params: { id }, body: { model: MODELS[0] } })
  assert.equal(synthNamed.status, 409)
  assertBlind('POST /api/compare/:id/synthesize (named model, pre-vote)', synthNamed.body)

  // not-found and invalid-id shapes
  assertBlind('GET /api/compare/:id (404)', (await call('get', '/api/compare/:id', { params: { id: 'abcdef' } })).body)
  assertBlind('GET /api/compare/:id (bad id)', (await call('get', '/api/compare/:id', { params: { id: '../x' } })).body)

  // create errors
  assertBlind('POST /api/compare (dup models)', (await call('post', '/api/compare',
    { body: { cwd: REPO, prompt: 'p', models: [MODELS[0], MODELS[0]] } })).body)
  assertBlind('POST /api/compare (bad cwd)', (await call('post', '/api/compare',
    { body: { cwd: '/no/such/dir', prompt: 'p', models: MODELS } })).body)
})

test('and after a vote every one of those numbers is served, so the sweep above is not vacuous', async () => {
  const id = (await call('post', '/api/compare', { body: { cwd: REPO, prompt: 'again', models: MODELS } })).body.id
  const pre = await call('get', '/api/compare/:id', { params: { id } })
  const label = pre.body.panes[0].label

  const voted = await call('post', '/api/compare/:id/vote', { params: { id }, body: { label } })
  assert.equal(voted.status, 200)

  const after = (await call('get', '/api/compare/:id', { params: { id } })).body
  assert.equal(after.voted, true)
  assert.deepEqual(Object.keys(after.mapping).sort(), ['A', 'B', 'C'])
  assert.deepEqual([...Object.values(after.mapping)].sort(), [...MODELS].sort())
  for (const p of after.panes) {
    assert.ok(MODELS.includes(p.model))
    if (PROFILE[p.model].error) assert.equal(p.error, PROFILE[p.model].error, 'the withheld error text arrives with the vote')
    else assert.equal(p.cost, PROFILE[p.model].cost)
  }
  // The negative control: the same sweep now FAILS, which is what proves it was measuring something.
  assert.throws(() => assertBlind('post-vote', after), /leaked/)
})
