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
