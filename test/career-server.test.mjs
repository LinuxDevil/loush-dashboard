import { test } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import mountCareer, { __test } from '../server-career.mjs'

// minimal express double: records handlers by method+path
function appDouble() {
  const routes = {}
  const reg = m => (p, h) => { routes[m + ' ' + p] = h }
  return { get: reg('GET'), post: reg('POST'), routes }
}
function res() { const r = { code: 200, body: null }; r.status = c => (r.code = c, r); r.json = b => (r.body = b, r); return r }

test('mountCareer registers the phase-1 routes', () => {
  const app = appDouble()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'career-srv-'))
  mountCareer(app, { track: (f, c) => fs.writeFileSync(f, c), readJson: (p, fb) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return fb } }, careerFile: path.join(dir, 'career.json'), usageDir: path.join(dir, 'usage-data') })
  for (const key of ['GET /api/career/snapshot', 'POST /api/career/refresh', 'GET /api/career/config', 'POST /api/career/config'])
    assert.ok(app.routes[key], `missing ${key}`)
})

test('config POST writes only authored keys', async () => {
  const app = appDouble()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'career-srv2-'))
  const file = path.join(dir, 'career.json')
  mountCareer(app, { track: (f, c) => fs.writeFileSync(f, c), readJson: (p, fb) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return fb } }, careerFile: file, usageDir: path.join(dir, 'usage-data') })
  const r = res()
  await app.routes['POST /api/career/config']({ body: { identity: { githubHandle: 'ali' } } }, r)
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).identity.githubHandle, 'ali')
})

test('snapshot exposes me.runningNow from readRunning dep', async () => {
  const app = appDouble()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'career-srv3-'))
  mountCareer(app, {
    track: (f, c) => fs.writeFileSync(f, c),
    readJson: (p, fb) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return fb } },
    careerFile: path.join(dir, 'career.json'),
    usageDir: path.join(dir, 'usage-data'),
    readRunning: () => [{ project: 'x', startedAt: 1 }],
  })
  const r = res()
  await app.routes['POST /api/career/refresh']({}, r)
  const r2 = res()
  await app.routes['GET /api/career/snapshot']({}, r2)
  assert.equal(r2.body.me.runningNow.length, 1)
  assert.equal(r2.body.me.runningNow[0].project, 'x')
})

test('POST /api/career/focus/act persists focusActed and hydrates actedOn on the next snapshot', async () => {
  const app = appDouble()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'career-srv4-'))
  mountCareer(app, {
    track: (f, c) => fs.writeFileSync(f, c),
    readJson: (p, fb) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return fb } },
    careerFile: path.join(dir, 'career.json'),
    usageDir: path.join(dir, 'usage-data'),
    readTasks: () => [{ id: 'tasks-1', stage: 'in-progress', bucket: 'inProgress', ageDays: 10, slaDays: 5, project: 'p', title: 'overdue ticket' }],
  })
  await app.routes['POST /api/career/refresh']({}, res())
  const r1 = res()
  await app.routes['GET /api/career/snapshot']({}, r1)
  const focus = r1.body.focus.find(f => f.id.startsWith('tasks:'))
  assert.ok(focus, 'expected a tasks-area focus item for the overdue ticket')
  assert.equal(focus.actedOn, null)

  const r2 = res()
  await app.routes['POST /api/career/focus/act']({ body: { id: focus.id, ref: 'tasks-1' } }, r2)
  assert.equal(r2.body.ok, true)

  await app.routes['POST /api/career/refresh']({}, res())
  const r3 = res()
  await app.routes['GET /api/career/snapshot']({}, r3)
  const focus2 = r3.body.focus.find(f => f.id === focus.id)
  assert.ok(focus2.actedOn, 'expected actedOn to be hydrated after acting on it')
  assert.equal(focus2.actedOn.ref, 'tasks-1')
})

test('mountCareer registers the brag/retro/export routes', () => {
  const app = appDouble()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'career-srv5-'))
  mountCareer(app, { track: (f, c) => fs.writeFileSync(f, c), readJson: (p, fb) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return fb } }, careerFile: path.join(dir, 'career.json'), usageDir: path.join(dir, 'usage-data') })
  for (const key of ['GET /api/career/brag', 'POST /api/career/brag', 'POST /api/career/retro', 'GET /api/career/story-so-far', 'GET /api/career/promo-packet'])
    assert.ok(app.routes[key], `missing ${key}`)
})

test('POST /api/career/brag appends an entry, GET returns it, and story-so-far includes it', async () => {
  const app = appDouble()
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'career-srv6-'))
  mountCareer(app, { track: (f, c) => fs.writeFileSync(f, c), readJson: (p, fb) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return fb } }, careerFile: path.join(dir, 'career.json'), usageDir: path.join(dir, 'usage-data') })

  const r1 = res()
  await app.routes['POST /api/career/brag']({ body: { entry: { title: 'X' } } }, r1)
  assert.equal(r1.body.ok, true)

  const r2 = res()
  await app.routes['GET /api/career/brag']({}, r2)
  assert.ok(r2.body.entries.some(e => e.title === 'X'), 'expected brag entries to contain title X')

  const r3 = res()
  await app.routes['GET /api/career/story-so-far']({}, r3)
  assert.ok(r3.body.markdown.includes('X'), 'expected story-so-far markdown to include X')
})
