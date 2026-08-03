import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { entry, readManifest, writeManifest } from '../../lib/dossier.mjs'

const repo = () => fs.mkdtempSync(path.join(os.tmpdir(), 'dossier-'))

// ---- the entry contract ----

test('a non-ok status without a reason is refused', () => {
  for (const status of ['unavailable', 'failed', 'skipped']) {
    assert.throws(() => entry({ stage: 'figma', status }), /reason/, `${status} must say why`)
  }
  assert.equal(entry({ stage: 'ac', status: 'ok' }).reason, null, 'ok needs no reason')
})

test('an unknown status is refused', () => {
  assert.throws(() => entry({ stage: 'ac', status: 'pending' }), /unknown status/)
  assert.throws(() => entry({ stage: 'ac', status: undefined }), /unknown status/)
})

test('a stage is required — an entry nothing can be keyed on is not an entry', () => {
  assert.throws(() => entry({ status: 'ok' }), /stage/)
})

// ---- round-trip ----

test('round-trip preserves provenance exactly, nesting included', () => {
  const dir = repo()
  const provenance = {
    groundedIn: 'web-app',
    handoff: { passed: ['ticket', 'repo', 'design-read'], excluded: ['sheet'] },
    reqHash: 'abc123', model: 'claude', cost: 0.41, turns: 6,
    consumedStale: ['ac'],
  }
  const e = entry({ stage: 'ac', status: 'ok', fetchedAt: '2026-08-03T09:14:22.000Z', artifacts: ['docs/ABC-1234/ac.md'], provenance })

  writeManifest(dir, 'ABC-1234', { ...readManifest(dir, 'ABC-1234'), stages: { ac: e } })
  const back = readManifest(dir, 'ABC-1234')

  assert.deepEqual(back.stages.ac, e)
  assert.deepEqual(back.stages.ac.provenance.handoff, provenance.handoff)
  assert.equal(back.key, 'ABC-1234')
})

test('the manifest lands in the target repo, git-tracked, under docs/<KEY>/', () => {
  const dir = repo()
  writeManifest(dir, 'abc-1234', { stages: {} })
  assert.ok(fs.existsSync(path.join(dir, 'docs', 'ABC-1234', 'manifest.json')), 'keyed by upper-case KEY')
})

// ---- never throws on read ----

test('a missing or corrupt manifest reads as empty rather than throwing', () => {
  const dir = repo()
  assert.deepEqual(readManifest(dir, 'ABC-1234'), { v: 1, key: 'ABC-1234', stages: {} })

  fs.mkdirSync(path.join(dir, 'docs', 'ABC-1234'), { recursive: true })
  fs.writeFileSync(path.join(dir, 'docs', 'ABC-1234', 'manifest.json'), '{ not json')
  assert.deepEqual(readManifest(dir, 'ABC-1234').stages, {}, 'a half-written file must not break the run')
})
