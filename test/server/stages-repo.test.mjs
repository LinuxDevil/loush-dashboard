import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { repo as repoStage } from '../../server/stages/repo.mjs'
import { WALK_CAP } from '../../server/ticket.mjs'

const KEY = 'ABC-1234'
const made = []
after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }) })

function ws({ git = true, files = 0 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stages-repo-'))
  made.push(dir)
  if (git) fs.mkdirSync(path.join(dir, '.git'))
  fs.writeFileSync(path.join(dir, 'README.md'), '# hi\n')
  for (let i = 0; i < files; i++) fs.writeFileSync(path.join(dir, `f${i}.js`), '\n')
  return { repoDir: dir, cacheDir: path.join(dir, '.cache'), key: KEY, cfg: {}, manifest: { stages: {} } }
}

test('a normal git workspace yields ok with tracked: true', async () => {
  const e = await repoStage(ws())
  assert.equal(e.stage, 'repo')
  assert.equal(e.status, 'ok')
  assert.equal(e.tracked, true)
  assert.ok(e.artifacts.length, 'the file list is written somewhere the next stage can read it')
  const list = JSON.parse(fs.readFileSync(e.artifacts[0], 'utf8'))
  assert.ok(list.files.includes('README.md'), 'the walk lists the checkout')
  assert.equal(e.provenance.fileCount, list.files.length)
  assert.ok(Array.isArray(e.provenance.skills) && Array.isArray(e.provenance.commands), 'capabilities are detected')
  assert.equal(e.provenance.refusesRun, undefined)
})

test('a vanished workspace dir is distinguishable from an ordinary unavailable source', async () => {
  const ctx = ws()
  fs.rmSync(ctx.repoDir, { recursive: true, force: true })
  const e = await repoStage(ctx)
  assert.notEqual(e.status, 'unavailable', 'an unavailable source lets the run continue — this must not')
  assert.equal(e.status, 'failed')
  assert.equal(e.provenance.refusesRun, 'workspace-vanished')
  assert.match(e.reason, /no longer exists on disk/)
  assert.match(e.reason, new RegExp(ctx.repoDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
})

test('a non-git workspace yields tracked: false with a reason naming what is lost', async () => {
  const e = await repoStage(ws({ git: false }))
  assert.equal(e.status, 'ok', 'a non-git workspace runs degraded, it does not fail')
  assert.equal(e.tracked, false)
  assert.match(e.reason, /not a git repo/i)
  for (const lost of [/pull request|\bPR\b/i, /machine wipe/i, /clone/i]) assert.match(e.reason, lost)
  const pre = e.provenance.premark['blast-radius']
  assert.equal(pre.status, 'unavailable')
  assert.match(pre.reason, /built_at_commit/)
})

test('a walk that hits the cap carries the checkout-truncated warning into the entry', async () => {
  const e = await repoStage(ws({ files: WALK_CAP + 5 }))
  assert.equal(e.status, 'ok')
  const w = e.provenance.warnings.find(x => x.kind === 'checkout-truncated')
  assert.ok(w, 'the truncation survives into the entry')
  assert.match(w.detail, new RegExp(String(WALK_CAP)))
  assert.match(w.detail, /matches nothing in the checkout/)
  assert.equal(e.provenance.truncated, true)
})

test('a full walk carries no truncation warning', async () => {
  const e = await repoStage(ws())
  assert.equal(e.provenance.truncated, false)
  assert.deepEqual(e.provenance.warnings, [])
})
