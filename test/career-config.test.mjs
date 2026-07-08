import { test } from 'node:test'
import assert from 'node:assert/strict'
import os from 'node:os'
import path from 'node:path'
import fs from 'node:fs'
import { CONFIG_VERSION, defaultConfig, migrate, makeStore } from '../career-config.mjs'

test('defaultConfig has all phase-1 collections and current version', () => {
  const c = defaultConfig()
  assert.equal(c.version, CONFIG_VERSION)
  for (const k of ['identity', 'projects', 'brag', 'retros', 'oneOnOnes', 'rollup', 'analyses'])
    assert.ok(k in c, `missing ${k}`)
  assert.deepEqual(c.identity.gitEmails, [])
})

test('migrate refuses a newer version', () => {
  assert.throws(() => migrate({ version: CONFIG_VERSION + 1 }), /newer than this build/)
})

test('migrate upgrades a versionless (v0) blob to current and marks changed', () => {
  const { cfg, changed } = migrate({ brag: [{ id: 'b1' }] })
  assert.equal(cfg.version, CONFIG_VERSION)
  assert.equal(changed, true)
  assert.equal(cfg.brag[0].id, 'b1') // preserves existing data
  assert.ok(Array.isArray(cfg.retros)) // backfills missing collections
})

test('makeStore read() persists a migration and write() deep-merges', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'career-'))
  const file = path.join(dir, 'career.json')
  fs.writeFileSync(file, JSON.stringify({ brag: [{ id: 'x' }] })) // v0
  const writes = []
  const track = (f, content) => { fs.writeFileSync(f, content); writes.push(f) }
  const readJson = (p, fb) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return fb } }
  const store = makeStore({ file, track, readJson })
  const c1 = store.read()
  assert.equal(c1.version, CONFIG_VERSION)
  assert.equal(writes.length, 1) // migration was persisted
  store.write({ identity: { githubHandle: 'ali' } })
  const c2 = store.read()
  assert.equal(c2.identity.githubHandle, 'ali')
  assert.equal(c2.brag[0].id, 'x') // merge preserved siblings
})
