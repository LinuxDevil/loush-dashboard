import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

// HOME is redirected before the module loads, so the store lands in a temp dir. Same trick as
// test/server/todos.test.mjs.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'compare-test-'))
process.env.HOME = TMP
process.env.USERPROFILE = TMP
const REPO = path.join(TMP, 'repo')
fs.mkdirSync(REPO, { recursive: true })

const { default: mountCompare, assignLabels, LABELS, MAX_MODELS } = await import('../../server/compare.mjs')

const MODELS = ['opus', 'sonnet', 'haiku']

// One deterministic "run" per model, with numbers far enough apart that a leak would be obvious.
const COSTS = { opus: 0.9, sonnet: 0.3, haiku: 0.02 }
const runAgent = async ({ model, prompt }) => (
  model === 'broken'
    ? { error: 'model exploded' }
    : { result: `answer from ${model} to ${prompt.slice(0, 12)}`, cost: COSTS[model] ?? 0.1, ms: 1000, turns: 2 }
)

function harness(deps = { runAgent }) {
  const routes = new Map()
  const app = {}
  for (const m of ['get', 'post', 'put', 'patch', 'delete']) app[m] = (p, h) => routes.set(m + ' ' + p, h)
  mountCompare(app, deps)
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
const reset = () => fs.rmSync(path.join(TMP, '.claude', 'dashboard-compare'), { recursive: true, force: true })
const start = async (models = MODELS, prompt = 'explain event loops') =>
  (await call('post', '/api/compare', { body: { cwd: REPO, prompt, models } })).body.id

process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }) } catch {} })

test('labels map 1:1 onto models — no duplicates, no drops, over many shuffles', () => {
  for (let i = 0; i < 500; i++) {
    const pairs = assignLabels(MODELS)
    assert.equal(pairs.length, MODELS.length)
    assert.deepEqual(pairs.map(p => p.label), LABELS.slice(0, MODELS.length), 'labels are assigned in order A, B, C…')
    assert.deepEqual([...new Set(pairs.map(p => p.model))].sort(), [...MODELS].sort())
  }
})

test('the shuffle actually shuffles — every model reaches every label', () => {
  const seen = new Map(MODELS.map(m => [m, new Set()]))
  for (let i = 0; i < 500; i++) for (const { label, model } of assignLabels(MODELS)) seen.get(model).add(label)
  for (const m of MODELS) assert.equal(seen.get(m).size, MODELS.length, `${m} never reached every label`)
})

test('a fresh comparison hides the mapping, the model names AND the per-pane numbers', async () => {
  reset()
  const id = await start()
  const { status, body } = await call('get', '/api/compare/:id', { params: { id } })
  assert.equal(status, 200)
  assert.equal(body.voted, false)
  assert.equal('mapping' in body, false, 'the mapping key is absent, not null-but-present')
  assert.equal(body.vote, null)
  assert.deepEqual(body.panes.map(p => p.label), ['A', 'B', 'C'])
  for (const p of body.panes) {
    assert.equal(p.model, null, 'a model name before the vote defeats the whole feature')
    assert.deepEqual([p.cost, p.ms, p.turns], [null, null, null], 'cost and latency identify a model as surely as its name')
    assert.ok(p.text, 'the answer itself is served — it is only the attribution that is withheld')
  }
  // No model name reaches the client through any field this server controls. The answer text is
  // excluded on purpose: a model is free to name itself in its own output and no server can stop
  // it, so asserting over `text` would be testing the fixture, not the blind property.
  const wire = JSON.stringify({ ...body, panes: body.panes.map(p => ({ ...p, text: '' })) })
  for (const m of MODELS) assert.equal(wire.includes(m), false, `"${m}" leaked into the pre-vote payload`)
})

test('voting reveals the mapping, and the panes gain their model and numbers', async () => {
  reset()
  const id = await start()
  const vote = await call('post', '/api/compare/:id/vote', { params: { id }, body: { label: 'B' } })
  assert.equal(vote.status, 200)
  assert.equal(vote.body.ok, true)
  assert.deepEqual(Object.keys(vote.body.mapping).sort(), ['A', 'B', 'C'])
  assert.deepEqual(Object.values(vote.body.mapping).sort(), [...MODELS].sort())
  assert.equal(vote.body.vote.model, vote.body.mapping.B, 'the vote names the model that was behind the label')

  const after = (await call('get', '/api/compare/:id', { params: { id } })).body
  assert.equal(after.voted, true)
  assert.deepEqual(after.mapping, vote.body.mapping)
  for (const p of after.panes) {
    assert.equal(p.model, after.mapping[p.label])
    assert.equal(p.cost, COSTS[p.model])
    assert.equal(p.turns, 2)
  }
})

test('a second vote is refused rather than rewriting history', async () => {
  reset()
  const id = await start()
  await call('post', '/api/compare/:id/vote', { params: { id }, body: { label: 'A' } })
  const again = await call('post', '/api/compare/:id/vote', { params: { id }, body: { label: 'B' } })
  assert.equal(again.status, 409)
})

test('a label that is not on the board is refused and the names are still withheld', async () => {
  reset()
  const id = await start()
  const r = await call('post', '/api/compare/:id/vote', { params: { id }, body: { label: 'Z' } })
  assert.equal(r.status, 400)
  assert.match(r.body.error, /label must be one of: A, B, C/)
  assert.equal('mapping' in (await call('get', '/api/compare/:id', { params: { id } })).body, false)
})

test('a bad id is rejected before it ever reaches the filesystem', async () => {
  reset()
  for (const id of ['../../etc/passwd', 'a/b', 'ABC123', 'short', 'waytoolongforanid', '', '.', 'ok id']) {
    for (const [method, route, body] of [
      ['get', '/api/compare/:id', {}],
      ['post', '/api/compare/:id/vote', { label: 'A' }],
      ['post', '/api/compare/:id/synthesize', {}],
      ['delete', '/api/compare/:id', {}],
    ]) {
      const r = await call(method, route, { params: { id }, body })
      assert.equal(r.status, 400, `${method} ${route} accepted the id "${id}"`)
      assert.match(r.body.error, /invalid comparison id/)
    }
  }
})

test('a well-formed id that does not exist is a 404, not a 500', async () => {
  reset()
  assert.equal((await call('get', '/api/compare/:id', { params: { id: 'abc123' } })).status, 404)
  assert.equal((await call('delete', '/api/compare/:id', { params: { id: 'abc123' } })).status, 404)
})

test('a model that errors still gets a pane', async () => {
  reset()
  const id = await start(['sonnet', 'broken'])
  const body = (await call('get', '/api/compare/:id', { params: { id } })).body
  assert.equal(body.panes.length, 2, 'the failure is shown, not dropped — two contenders ran')
  const failed = body.panes.find(p => p.error)
  assert.equal(failed.error, 'model exploded')
  assert.equal(failed.model, null, 'even the failing pane keeps its anonymity')
})

test('the request body is validated before anything runs', async () => {
  reset()
  const cases = [
    [{ cwd: REPO, prompt: '', models: MODELS }, /prompt is required/],
    [{ cwd: REPO, prompt: 'p', models: [] }, /non-empty array/],
    [{ cwd: REPO, prompt: 'p', models: 'sonnet' }, /non-empty array/],
    [{ cwd: REPO, prompt: 'p', models: LABELS.concat('G') }, new RegExp(`at most ${MAX_MODELS} models`)],
    [{ cwd: REPO, prompt: 'p', models: ['sonnet', 'sonnet'] }, /the same model twice/],
    [{ cwd: 'relative/path', prompt: 'p', models: MODELS }, /absolute path/],
    [{ cwd: path.join(TMP, 'nope'), prompt: 'p', models: MODELS }, /does not exist/],
  ]
  for (const [body, re] of cases) {
    const r = await call('post', '/api/compare', { body })
    assert.equal(r.status, 400, JSON.stringify(body))
    assert.match(r.body.error, re)
  }
  assert.deepEqual((await call('get', '/api/compare')).body, [], 'nothing was persisted by a rejected request')
})

test('the past-comparisons list counts the models but never names them', async () => {
  reset()
  const a = await start(MODELS, 'first question')
  const b = await start(['sonnet'], 'second question')
  await call('post', '/api/compare/:id/vote', { params: { id: b }, body: { label: 'A' } })

  const list = (await call('get', '/api/compare')).body
  assert.equal(list.length, 2)
  assert.deepEqual(list.map(x => x.id).sort(), [a, b].sort())
  assert.deepEqual(list.find(x => x.id === a), { id: a, prompt: 'first question', at: list.find(x => x.id === a).at, models: 3, voted: false })
  assert.equal(list.find(x => x.id === b).voted, true)
  for (const m of MODELS) assert.equal(JSON.stringify(list).includes(m), false, `"${m}" leaked into the list`)
})

test('synthesis is refused before a vote and produced after one', async () => {
  reset()
  const id = await start()
  const early = await call('post', '/api/compare/:id/synthesize', { params: { id } })
  assert.equal(early.status, 409)
  assert.match(early.body.error, /vote first/)

  const mapping = (await call('post', '/api/compare/:id/vote', { params: { id }, body: { label: 'C' } })).body.mapping
  const late = await call('post', '/api/compare/:id/synthesize', { params: { id } })
  assert.equal(late.status, 200)
  assert.equal(late.body.model, mapping.C, 'the winner writes the synthesis by default')
  assert.match(late.body.text, /answer from/)
  assert.equal((await call('get', '/api/compare/:id', { params: { id } })).body.synthesis.text, late.body.text)
})

test('the synthesis prompt carries every answer that exists, under its label', async () => {
  reset()
  const seen = []
  const call2 = harness({ runAgent: async a => { seen.push(a.prompt); return runAgent(a) } })
  const id = (await call2('post', '/api/compare', { body: { cwd: REPO, prompt: 'the question', models: ['sonnet', 'broken'] } })).body.id
  await call2('post', '/api/compare/:id/vote', { params: { id }, body: { label: 'A' } })
  await call2('post', '/api/compare/:id/synthesize', { params: { id } })
  const p = seen.at(-1)
  assert.match(p, /## The original request\nthe question/)
  assert.match(p, /## Answer [AB]\nanswer from sonnet/)
  assert.equal((p.match(/## Answer /g) || []).length, 1, 'the pane that errored has no answer to contribute')
})

test('synthesis is refused when every model failed', async () => {
  reset()
  const id = await start(['broken'])
  await call('post', '/api/compare/:id/vote', { params: { id }, body: { label: 'A' } })
  const r = await call('post', '/api/compare/:id/synthesize', { params: { id } })
  assert.equal(r.status, 409)
  assert.match(r.body.error, /nothing to synthesise/)
})

test('delete removes the comparison from the list', async () => {
  reset()
  const id = await start()
  assert.equal((await call('delete', '/api/compare/:id', { params: { id } })).body.ok, true)
  assert.deepEqual((await call('get', '/api/compare')).body, [])
})

test('a corrupt file is skipped instead of taking the list down', async () => {
  reset()
  const id = await start()
  fs.writeFileSync(path.join(TMP, '.claude', 'dashboard-compare', 'junkfile.json'), '{not json')
  const list = (await call('get', '/api/compare')).body
  assert.deepEqual(list.map(x => x.id), [id])
})
