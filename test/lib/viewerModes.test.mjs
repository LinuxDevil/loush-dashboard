import { test } from 'node:test'
import assert from 'node:assert/strict'
import { modeAvailability, resolveMode, PREVIEW_MAX_BYTES } from '../../src/lib/viewerModes.js'

const get = (av, id) => av.modes.find(m => m.id === id)

test('markdown previews, and preview is the default view', () => {
  const av = modeAvailability({ ext: 'md', size: 1000 })
  assert.equal(get(av, 'preview').available, true)
  assert.equal(av.defaultMode, 'preview')
})

test('.mjs disables Preview WITH a reason', () => {
  const p = get(modeAvailability({ ext: 'mjs', size: 500 }), 'preview')
  assert.equal(p.available, false)
  assert.ok(p.reason && p.reason.length > 10, 'a reason is present for the hover tooltip')
  assert.match(p.reason, /JavaScript module/)
})

test('.mjs still falls back to Source as the default, but Preview stays visibly disabled', () => {
  const av = modeAvailability({ ext: 'mjs' })
  assert.equal(av.defaultMode, 'source')
  assert.equal(av.modes.length, 3, 'the disabled tab is still listed, not hidden')
})

test('an unknown extension is unknown — not assumed previewable and not assumed text', () => {
  const av = modeAvailability({ ext: 'wat', size: 10 })
  assert.equal(av.unknownType, true)
  assert.match(get(av, 'preview').reason, /no preview renderer is registered/)
  assert.match(get(av, 'preview').reason, /rather than guess/)
})

test('a binary file has neither Source nor Preview, each with its own reason', () => {
  const av = modeAvailability({ ext: 'bin', isBinary: true, size: 100 })
  assert.equal(get(av, 'source').available, false)
  assert.match(get(av, 'source').reason, /binary/)
  assert.equal(get(av, 'preview').available, false)
  assert.match(get(av, 'preview').reason, /binary/)
})

test('Diff is unavailable without a baseline and says why', () => {
  const d = get(modeAvailability({ ext: 'md' }), 'diff')
  assert.equal(d.available, false)
  assert.match(d.reason, /no baseline/)
})

test('Diff is available once a baseline exists', () => {
  assert.equal(get(modeAvailability({ ext: 'md', hasBaseline: true }), 'diff').available, true)
})

test('a huge previewable file keeps Preview but warns about the render cap', () => {
  const p = get(modeAvailability({ ext: 'md', size: PREVIEW_MAX_BYTES * 3 }), 'preview')
  assert.equal(p.available, true)
  assert.match(p.warning, /only the first/)
})

test('an unknown size is stated, not treated as zero', () => {
  const s = get(modeAvailability({ ext: 'md', size: undefined }), 'source')
  assert.match(s.warning, /size is unknown/)
})

test('extension is derived from the name when ext is absent', () => {
  assert.equal(get(modeAvailability({ name: 'notes.md' }), 'preview').available, true)
})

test('a file with no extension at all is unknown, and says so in the reason', () => {
  const p = get(modeAvailability({ name: 'LICENSE' }), 'preview')
  assert.equal(p.available, false)
  assert.match(p.reason, /no extension/)
})

test('resolveMode reports the fallback rather than swapping silently', () => {
  const av = modeAvailability({ ext: 'mjs' })
  const r = resolveMode('preview', av)
  assert.equal(r.mode, 'source')
  assert.equal(r.changed, true)
  assert.match(r.reason, /Preview is unavailable/)
})

test('resolveMode leaves an available mode alone', () => {
  const r = resolveMode('source', modeAvailability({ ext: 'mjs' }))
  assert.equal(r.changed, false)
  assert.equal(r.reason, null)
})

test('a nonsense mode name resolves with a reason instead of throwing', () => {
  const r = resolveMode('wibble', modeAvailability({ ext: 'md' }))
  assert.equal(r.changed, true)
  assert.match(r.reason, /not a view mode/)
})

test('when nothing is available the caller gets mode null plus every reason', () => {
  const r = resolveMode('source', modeAvailability({ ext: 'bin', isBinary: true }))
  assert.equal(r.mode, null)
  assert.match(r.reason, /no view mode is available/)
})

test('garbage input never throws', () => {
  for (const bad of [null, undefined, 42, 'x', [], { ext: 5 }, { size: 'big' }])
    assert.doesNotThrow(() => resolveMode('source', modeAvailability(bad)))
})
