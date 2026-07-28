// test/server/todos.test.mjs — the /api/todos routes, against a real store in a temp HOME.
//
// mountTodos touches exactly two things outside itself: the injected transcript readers and one JSON
// file under ~/.claude. Both are substitutable, so these run the ACTUAL handlers — no express, no
// network, no ~/.claude of whoever is running the suite. HOME is redirected before the module is
// imported because the store path is resolved at module load, which is also the property that keeps
// a stray import from writing into a developer's real todo list.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { dayStart } from '../../lib/todos.mjs'

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'todos-test-'))
process.env.HOME = TMP
process.env.USERPROFILE = TMP
const { default: mountTodos } = await import('../../server/todos.mjs')

const STORE = path.join(TMP, '.claude', 'dashboard-todos.json')
const DAY = '2025-07-28'
const REPO = path.join(TMP, 'repo')

// One session in `REPO`, three edits on the 28th (two to the same file), one on the 27th, and one
// tool error on a file the agent did edit. This is the shape scanTranscripts/failStats actually return.
const scanTranscripts = () => ({
  sessions: [{ sessionId: 's1', cwd: REPO }],
  edits: [
    { t: dayStart(DAY) + 3_600_000, file: path.join(REPO, 'src/ui/Drawer.jsx'), add: 10, del: 1, sessionId: 's1' },
    { t: dayStart(DAY) + 7_200_000, file: path.join(REPO, 'src/ui/Drawer.jsx'), add: 3, del: 0, sessionId: 's1' },
    { t: dayStart(DAY) + 7_300_000, file: path.join(REPO, 'server/index.mjs'), add: 2, del: 2, sessionId: 's1' },
    { t: dayStart('2025-07-27') + 3_600_000, file: path.join(REPO, 'src/old.jsx'), add: 1, del: 1, sessionId: 's1' },
  ],
  prompts: [],
})
const failStats = () => [{ sessionId: 's1', errs: [{ t: dayStart(DAY) + 3_700_000, file: path.join(REPO, 'src/ui/Drawer.jsx'), tool: 'Edit', text: 'string not found' }] }]

// A router stub with the four verbs mountTodos uses, plus a caller that runs a handler and returns
// {status, body} — the same contract express gives the handler.
function harness() {
  const routes = new Map()
  const app = {}
  for (const m of ['get', 'post', 'patch', 'delete']) app[m] = (p, h) => routes.set(m + ' ' + p, h)
  mountTodos(app, { scanTranscripts, failStats })
  return (method, urlPath, { query = {}, params = {}, body = {} } = {}) => {
    const h = routes.get(method + ' ' + urlPath)
    assert.ok(h, `no handler for ${method} ${urlPath}`)
    let status = 200, out
    const res = { status(c) { status = c; return this }, json(b) { out = b; return this } }
    h({ query, params, body }, res)
    return { status, body: out }
  }
}

fs.mkdirSync(REPO, { recursive: true })
const call = harness()
const reset = () => { try { fs.rmSync(STORE) } catch {} }

test('an empty store answers with the day, not an error', () => {
  reset()
  const { status, body } = call('get', '/api/todos', { query: { date: DAY } })
  assert.equal(status, 200)
  assert.equal(body.date, DAY)
  assert.deepEqual(body.todos, [])
  assert.deepEqual(body.stats, { total: 0, done: 0, open: 0, byStatus: body.stats.byStatus })
  assert.equal(body.statuses.length, 7)
})

test('create → read round-trips through the store file', () => {
  reset()
  const created = call('post', '/api/todos', { body: { title: 'ship the drawer', date: DAY, status: 'in-progress', root: REPO, file: 'src/ui/Drawer.jsx' } })
  assert.equal(created.status, 200)
  assert.equal(created.body.dir, 'src/ui')
  assert.ok(fs.existsSync(STORE), 'the store is written under the redirected HOME')

  const day = call('get', '/api/todos', { query: { date: DAY } })
  assert.equal(day.body.todos.length, 1)
  assert.equal(day.body.stats.open, 1)
  assert.equal(day.body.tree.dirs[0].dir, 'src/ui')
  assert.equal(day.body.tree.dirs[0].files[0].file, 'src/ui/Drawer.jsx')
  assert.deepEqual(day.body.days, [DAY])
})

test('a todo filed on another day is not in this day', () => {
  reset()
  call('post', '/api/todos', { body: { title: 'other day', date: '2025-07-20' } })
  assert.equal(call('get', '/api/todos', { query: { date: DAY } }).body.todos.length, 0)
  assert.equal(call('get', '/api/todos', { query: { date: '2025-07-20' } }).body.todos.length, 1)
})

test('a title-less create is refused with a message, not a 500', () => {
  reset()
  const r = call('post', '/api/todos', { body: { date: DAY } })
  assert.equal(r.status, 400)
  assert.match(r.body.error, /title is required/)
})

test('an unknown stage on PATCH is refused and names the valid ones', () => {
  reset()
  const t = call('post', '/api/todos', { body: { title: 'a', date: DAY } }).body
  const r = call('patch', '/api/todos/:id', { params: { id: t.id }, body: { status: 'qa-ish' } })
  assert.equal(r.status, 400)
  assert.match(r.body.error, /draft, in-progress, code-review, design-qa, manual-qa, ready-for-release, live/)
})

test('patching an unknown id is a 404, and deleting one too', () => {
  reset()
  assert.equal(call('patch', '/api/todos/:id', { params: { id: 'nope' }, body: { done: true } }).status, 404)
  assert.equal(call('delete', '/api/todos/:id', { params: { id: 'nope' } }).status, 404)
})

test('ticking a todo persists and moves it out of the open count', () => {
  reset()
  const t = call('post', '/api/todos', { body: { title: 'a', date: DAY } }).body
  call('patch', '/api/todos/:id', { params: { id: t.id }, body: { done: true } })
  const count = call('get', '/api/todos/count', { query: { date: DAY } }).body
  assert.deepEqual({ open: count.open, total: count.total }, { open: 0, total: 1 })
})

test('the repo filter hides other repos but never hides unbound todos', () => {
  reset()
  call('post', '/api/todos', { body: { title: 'bound here', date: DAY, root: REPO } })
  call('post', '/api/todos', { body: { title: 'bound elsewhere', date: DAY, root: '/somewhere/else' } })
  call('post', '/api/todos', { body: { title: 'call the designer', date: DAY } })
  const titles = call('get', '/api/todos', { query: { date: DAY, root: REPO } }).body.todos.map(t => t.title)
  assert.deepEqual(titles.sort(), ['bound here', 'call the designer'])
})

test('unfinished earlier work carries over; finished work does not', () => {
  reset()
  const old = call('post', '/api/todos', { body: { title: 'yesterday, unfinished', date: '2025-07-27' } }).body
  const done = call('post', '/api/todos', { body: { title: 'yesterday, done', date: '2025-07-27' } }).body
  call('patch', '/api/todos/:id', { params: { id: done.id }, body: { done: true } })

  const day = call('get', '/api/todos', { query: { date: DAY } }).body
  assert.deepEqual(day.carry.map(t => t.id), [old.id])

  const moved = call('post', '/api/todos/move', { body: { ids: [old.id], date: DAY } })
  assert.equal(moved.body.moved, 1)
  const after = call('get', '/api/todos', { query: { date: DAY } }).body
  assert.equal(after.carry.length, 0)
  assert.equal(after.todos.length, 1)
})

test('move refuses a bad date instead of filing todos under a garbage key', () => {
  reset()
  const t = call('post', '/api/todos', { body: { title: 'a', date: DAY } }).body
  assert.equal(call('post', '/api/todos/move', { body: { ids: [t.id], date: '28.7.2025' } }).status, 400)
})

test('suggest reads the injected transcripts and scopes to the day and repo', () => {
  reset()
  const s = call('get', '/api/todos/suggest', { query: { date: DAY } }).body
  assert.equal(s.available, true)
  assert.equal(s.root, REPO)
  assert.equal(s.files, 2, 'the 27th edit is not in the 28th')
  assert.deepEqual(s.dirs.map(d => d.dir), ['src/ui', 'server'])
  const drawer = s.dirs[0].files[0]
  assert.equal(drawer.edits, 2)
  assert.equal(drawer.failures, 1, 'tool errors join onto the file that hit them')
})

test('import files the suggested paths as drafts with their evidence, and never twice', () => {
  reset()
  const r = call('post', '/api/todos/import', { body: { root: REPO, date: DAY, files: ['src/ui/Drawer.jsx', 'server/index.mjs'] } })
  assert.equal(r.body.added.length, 2)
  const drawer = r.body.added.find(t => t.file === 'src/ui/Drawer.jsx')
  assert.equal(drawer.status, 'draft')
  assert.equal(drawer.source, 'workingset')
  assert.equal(drawer.dir, 'src/ui')
  assert.equal(drawer.evidence.edits, 2)
  assert.equal(drawer.evidence.failures, 1)
  assert.match(drawer.notes, /Agent edited this on 2025-07-28/)

  const again = call('post', '/api/todos/import', { body: { root: REPO, date: DAY, files: ['src/ui/Drawer.jsx'] } })
  assert.equal(again.body.added.length, 0)
  assert.equal(again.body.skipped[0].why, 'already on this day')

  // and the suggestion panel now says so rather than offering the same file again
  const s = call('get', '/api/todos/suggest', { query: { date: DAY } }).body
  assert.equal(s.dirs[0].files[0].hasTodo, true)
})

test('import rejects a path that escapes the repo', () => {
  reset()
  const r = call('post', '/api/todos/import', { body: { root: REPO, date: DAY, files: ['../../../etc/passwd'] } })
  assert.equal(r.body.added.length, 0)
  assert.equal(r.body.skipped[0].why, 'invalid path')
})

test('with no transcript history at all, suggest explains itself instead of showing an empty board', () => {
  reset()
  const app = {}
  const routes = new Map()
  for (const m of ['get', 'post', 'patch', 'delete']) app[m] = (p, h) => routes.set(m + ' ' + p, h)
  mountTodos(app, { scanTranscripts: () => ({ sessions: [], edits: [], prompts: [] }), failStats: () => [] })
  let out
  routes.get('get /api/todos/suggest')({ query: { date: DAY }, params: {}, body: {} }, { status() { return this }, json(b) { out = b } })
  assert.equal(out.available, false)
  assert.equal(out.reason, 'no-agent-history')
  assert.match(out.detail, /Todos typed by hand still work/)
})

test('writes go through the injected tracker when the host provides one', () => {
  reset()
  const app = {}
  const routes = new Map()
  for (const m of ['get', 'post', 'patch', 'delete']) app[m] = (p, h) => routes.set(m + ' ' + p, h)
  const tracked = []
  mountTodos(app, { scanTranscripts, failStats, track: (file, body, opts) => { tracked.push(opts.summary); fs.writeFileSync(file, body) } })
  routes.get('post /api/todos')({ query: {}, params: {}, body: { title: 'tracked write', date: DAY } }, { status() { return this }, json() {} })
  assert.equal(tracked.length, 1)
  assert.match(tracked[0], /todo added: tracked write/)
})

test('a corrupt store degrades to an empty day instead of throwing', () => {
  reset()
  fs.mkdirSync(path.dirname(STORE), { recursive: true })
  fs.writeFileSync(STORE, '{not json')
  const r = call('get', '/api/todos', { query: { date: DAY } })
  assert.equal(r.status, 200)
  assert.deepEqual(r.body.todos, [])
})

process.on('exit', () => { try { fs.rmSync(TMP, { recursive: true, force: true }) } catch {} })
