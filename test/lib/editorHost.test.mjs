import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  nextHostState, classifyWatchEvent, makeWriteReceipt, pruneReceipts,
  validateAdapter, createEditorHost, ECHO_SETTLE_MS,
} from '../../src/lib/editorHost.js'

const S = (status, over = {}) => ({ status, dirty: false, generation: 0, ...over })

// --- state machine ---------------------------------------------------------

test('the happy path is idle → loading → ready and pushes content via applyContent', () => {
  const a = nextHostState(S('idle'), { type: 'load' })
  assert.equal(a.status, 'loading')
  assert.equal(a.effect, 'read')
  const b = nextHostState(a, { type: 'loaded' })
  assert.equal(b.status, 'ready')
  // Content goes to the editor, never into React state — that is the whole point of the effect name.
  assert.equal(b.effect, 'applyContent')
})

test('save bumps the generation at issue time, so a watcher firing mid-write can be attributed', () => {
  const s = nextHostState(S('ready', { generation: 3 }), { type: 'save' })
  assert.equal(s.status, 'saving')
  assert.equal(s.generation, 4)
  assert.equal(s.effect, 'write')
})

test('a failed save keeps the buffer dirty', () => {
  const s = nextHostState(S('saving', { dirty: true }), { type: 'saveFailed', reason: 'EACCES' })
  assert.equal(s.status, 'error')
  assert.equal(s.dirty, true, 'clearing dirty here would claim the work is on disk when it is not')
  assert.equal(s.reason, 'EACCES')
})

test('a refused transition explains itself instead of silently no-opping', () => {
  const r = nextHostState(S('saving'), { type: 'load' })
  assert.equal(r.refused, true)
  assert.match(r.reason, /save is in flight/)
  assert.equal(r.status, 'saving', 'the state is unchanged')
})

test('an external change while dirty is refused with a reason — the user must choose', () => {
  const r = nextHostState(S('ready', { dirty: true }), { type: 'externalChange' })
  assert.equal(r.refused, true)
  assert.match(r.reason, /unsaved edits/)
})

test('an external change while clean reloads', () => {
  const r = nextHostState(S('ready'), { type: 'externalChange' })
  assert.equal(r.status, 'reloading')
  assert.equal(r.effect, 'read')
})

test('disposed is terminal — a late event cannot resurrect a closed viewer', () => {
  const r = nextHostState(S('disposed'), { type: 'loaded' })
  assert.equal(r.refused, true)
  assert.equal(r.status, 'disposed')
})

test('a load failure carries a reason even when the caller supplies none', () => {
  const r = nextHostState(S('loading'), { type: 'loadFailed' })
  assert.equal(r.status, 'error')
  assert.ok(r.reason && r.reason.length > 5)
})

test('unknown events and garbage states never throw', () => {
  for (const st of [null, undefined, 5, 'x', {}, { status: 'nope' }])
    for (const ev of [null, undefined, 5, {}, { type: 'wat' }])
      assert.doesNotThrow(() => nextHostState(st, ev))
  assert.match(nextHostState(S('idle'), { type: 'wat' }).reason, /unknown lifecycle event/)
})

// --- echo detection --------------------------------------------------------

const receipt = (gen, at, content, stat = null) => makeWriteReceipt({ generation: gen, at, content, stat })

test('with no outstanding write, any change is external', () => {
  const v = classifyWatchEvent([], { at: 100 })
  assert.equal(v.verdict, 'external')
  assert.equal(v.certain, true)
})

test('an exact mtime+size match is a certain echo', () => {
  const v = classifyWatchEvent([receipt(1, 0, 'a', { mtimeMs: 500, size: 1 })], { at: 10, stat: { mtimeMs: 500, size: 1 } })
  assert.equal(v.verdict, 'echo')
  assert.equal(v.certain, true)
  assert.equal(v.receiptGeneration, 1)
})

test('byte-identical content is a certain echo even without a stat', () => {
  const v = classifyWatchEvent([receipt(2, 0, 'hello')], { at: 10, content: 'hello' })
  assert.equal(v.verdict, 'echo')
  assert.equal(v.certain, true)
})

// The naive "compare the content" check fails exactly here: the formatter rewrote the file, so the
// bytes on disk differ from the bytes we wrote. Only the write generation + timing can catch it.
test('a formatter rewriting our save is caught as an UNCERTAIN echo, not an external change', () => {
  const v = classifyWatchEvent([receipt(3, 1000, 'const a=1', { mtimeMs: 9, size: 9 })],
    { at: 1200, content: 'const a = 1\n', stat: { mtimeMs: 11, size: 12 } })
  assert.equal(v.verdict, 'echo', 'reloading here would wipe keystrokes typed since the save')
  assert.equal(v.certain, false, 'the heuristic must admit it is a heuristic')
  assert.match(v.reason, /save-time rewrite/)
})

// The documented residual case, asserted so the limit is a known property rather than a surprise.
test('a genuine outside write inside the settle window is indistinguishable and is named as such', () => {
  const v = classifyWatchEvent([receipt(4, 1000, 'mine')], { at: 1100, content: 'someone else wrote this' })
  assert.equal(v.verdict, 'echo')
  assert.equal(v.certain, false)
  assert.match(v.reason, /indistinguishable/)
})

test('past the settle window a differing write is external', () => {
  const v = classifyWatchEvent([receipt(5, 1000, 'mine')], { at: 1000 + ECHO_SETTLE_MS + 1, content: 'theirs' })
  assert.equal(v.verdict, 'external')
  assert.equal(v.certain, true)
})

test('the newest write wins in a rapid save/save burst', () => {
  const v = classifyWatchEvent([receipt(1, 0, 'a'), receipt(2, 100, 'b')], { at: 150, content: 'c' })
  assert.equal(v.receiptGeneration, 2)
})

test('classifyWatchEvent never throws on garbage', () => {
  for (const r of [null, undefined, 5, 'x', [null]])
    for (const e of [null, undefined, 5, {}])
      assert.doesNotThrow(() => classifyWatchEvent(r, e))
})

test('pruneReceipts drops stale entries but always keeps the newest', () => {
  const kept = pruneReceipts([receipt(1, 0, 'a'), receipt(2, 100000, 'b')], 100000, 100)
  assert.equal(kept.length, 1)
  assert.equal(kept[0].generation, 2)
})

test('a write with no stat records stat:null rather than a fabricated zero', () => {
  assert.equal(makeWriteReceipt({ generation: 1, at: 0, content: 'x' }).stat, null)
  assert.equal(makeWriteReceipt({ generation: 1, at: 0, content: 'x', stat: { mtimeMs: NaN, size: 1 } }).stat, null)
})

// --- adapter validation ----------------------------------------------------

test('a missing adapter member is named, not guessed around', () => {
  const v = validateAdapter({ applyContent() {} })
  assert.equal(v.ok, false)
  assert.deepEqual(v.missing, ['getCurrentContent'])
  assert.match(v.reason, /getCurrentContent/)
})

test('optional members show up as degraded capabilities, not failures', () => {
  const v = validateAdapter({ applyContent() {}, getCurrentContent() { return '' } })
  assert.equal(v.ok, true)
  assert.ok(v.degraded.includes('setTheme'))
})

test('no adapter at all is a reason, not a throw', () => {
  assert.doesNotThrow(() => validateAdapter(null))
  assert.equal(validateAdapter(null).ok, false)
})

// --- factory ---------------------------------------------------------------

function fakeEditor(initial = '') {
  let buf = initial
  return {
    buf: () => buf,
    type: t => { buf += t },
    adapter: {
      applyContent(t) { buf = t },
      getCurrentContent() { return buf },
    },
  }
}

test('load pushes disk content into the editor and sets the diff baseline', async () => {
  const ed = fakeEditor()
  const host = createEditorHost({ adapter: ed.adapter, path: '/a.md', io: { read: async () => ({ content: 'from disk' }) } })
  const r = await host.load()
  assert.equal(r.ok, true)
  assert.equal(ed.buf(), 'from disk')
  assert.equal(host.getState().status, 'ready')
  assert.equal(host.getState().hasBaseline, true)
})

test('a failed load leaves a reason on the state and does not invent content', async () => {
  const ed = fakeEditor('untouched')
  const host = createEditorHost({ adapter: ed.adapter, io: { read: async () => ({ ok: false, reason: 'ENOENT' }) } })
  const r = await host.load()
  assert.equal(r.ok, false)
  assert.equal(r.content, null)
  assert.equal(r.reason, 'ENOENT')
  assert.equal(host.getState().status, 'error')
  assert.equal(ed.buf(), 'untouched', 'the editor was not blanked')
})

test('a read that throws becomes a reason, never an exception', async () => {
  const host = createEditorHost({ adapter: fakeEditor().adapter, io: { read: async () => { throw new Error('boom') } } })
  const r = await host.load()
  assert.equal(r.ok, false)
  assert.match(r.reason, /boom/)
})

test('save pulls from the editor, not from any cached React value', async () => {
  const ed = fakeEditor()
  let written = null
  const host = createEditorHost({ adapter: ed.adapter, io: { read: async () => ({ content: 'v1' }), write: async (p, c) => { written = c; return { ok: true } } } })
  await host.load()
  ed.type(' + typed after load')     // straight into the editor, bypassing the host entirely
  await host.save()
  assert.equal(written, 'v1 + typed after load')
})

test('the host ignores the watcher event caused by its own save', async () => {
  const ed = fakeEditor()
  let reads = 0
  let t = 1000
  const host = createEditorHost({
    adapter: ed.adapter,
    io: { now: () => t, read: async () => { reads++; return { content: 'v1' } }, write: async () => ({ ok: true, stat: { mtimeMs: 42, size: 2 } }) },
  })
  await host.load()
  assert.equal(reads, 1)
  await host.save()
  t = 1010
  const w = await host.watch({ at: 1010, stat: { mtimeMs: 42, size: 2 } })
  assert.equal(w.verdict, 'echo')
  assert.equal(w.reloaded, false)
  assert.equal(reads, 1, 'no reload was triggered by our own write')
})

test('a real external change reloads and re-pushes into the editor', async () => {
  const ed = fakeEditor()
  let disk = 'v1'
  let t = 1000
  const host = createEditorHost({ adapter: ed.adapter, io: { now: () => t, read: async () => ({ content: disk }), write: async () => ({ ok: true }) } })
  await host.load()
  disk = 'changed by someone else'
  t = 99999
  const w = await host.watch({ at: 99999, content: disk })
  assert.equal(w.verdict, 'external')
  assert.equal(w.reloaded, true)
  assert.equal(ed.buf(), 'changed by someone else')
})

test('an external change is not applied over unsaved edits — it is reported as blocked', async () => {
  const ed = fakeEditor()
  let t = 1000
  const host = createEditorHost({ adapter: ed.adapter, io: { now: () => t, read: async () => ({ content: 'v1' }) } })
  await host.load()
  host.markDirty()
  ed.type(' unsaved')
  t = 99999
  const w = await host.watch({ at: 99999, content: 'disk moved on' })
  assert.equal(w.reloaded, false)
  assert.match(w.blocked, /unsaved edits/)
  assert.equal(ed.buf(), 'v1 unsaved', 'the user\'s work survived')
  assert.ok(host.getState().notices.some(n => /not reloaded/.test(n.text)), 'and the user is told')
})

test('an uncertain echo leaves a visible notice', async () => {
  const ed = fakeEditor()
  let t = 1000
  const host = createEditorHost({ adapter: ed.adapter, io: { now: () => t, read: async () => ({ content: 'v1' }), write: async () => ({ ok: true }) } })
  await host.load()
  await host.save()
  t = 1100
  await host.watch({ at: 1100, content: 'v1;   // reformatted' })
  assert.ok(host.getState().notices.some(n => /ignored a file-change event/.test(n.text)))
})

test('diff compares the saved baseline against the live buffer', async () => {
  const ed = fakeEditor()
  const host = createEditorHost({ adapter: ed.adapter, io: { read: async () => ({ content: 'a\nb' }) } })
  await host.load()
  ed.type('\nc')
  const d = host.diff()
  assert.equal(d.stats.added, 1)
  assert.equal(d.stats.removed, 0)
})

test('diff before any load is a reason, not a fabricated empty baseline', () => {
  const host = createEditorHost({ adapter: fakeEditor().adapter, io: {} })
  const d = host.diff()
  assert.equal(d.hunks, null)
  assert.match(d.reason, /no baseline/)
})

test('theme on an adapter without setTheme is reported as not applied', () => {
  const host = createEditorHost({ adapter: fakeEditor().adapter, io: {} })
  const r = host.theme('light')
  assert.equal(r.applied, false)
  assert.match(r.reason, /does not implement setTheme/)
  assert.equal(host.getState().theme, 'light', 'the host-level theme still moved')
})

test('theme reaches an adapter that implements it', () => {
  let got = null
  const ed = fakeEditor()
  const host = createEditorHost({ adapter: { ...ed.adapter, setTheme: n => { got = n } }, io: {} })
  assert.equal(host.theme('light').applied, true)
  assert.equal(got, 'light')
})

test('an editor that throws on getCurrentContent yields content:null plus a reason', () => {
  const host = createEditorHost({ adapter: { applyContent() {}, getCurrentContent() { throw new Error('unmounted') } }, io: {} })
  const r = host.getCurrentContent()
  assert.equal(r.content, null)
  assert.match(r.reason, /unmounted/)
})

test('a host with a broken adapter starts in error with a reason, and does not throw when driven', async () => {
  const host = createEditorHost({ adapter: {}, io: { read: async () => ({ content: 'x' }) } })
  assert.equal(host.getState().status, 'error')
  assert.match(host.getState().reason, /missing/)
  await assert.doesNotReject(() => host.load())
  assert.doesNotThrow(() => host.diff())
})

test('save without a write() is a reason, not a crash, and the buffer stays dirty', async () => {
  const ed = fakeEditor()
  const host = createEditorHost({ adapter: ed.adapter, io: { read: async () => ({ content: 'v1' }) } })
  await host.load()
  const r = await host.save()
  assert.equal(r.ok, false)
  assert.match(r.reason, /no write/)
  assert.equal(host.getState().dirty, true)
})

test('a save with no stat announces that echo detection fell back to timing', async () => {
  const ed = fakeEditor()
  const host = createEditorHost({ adapter: ed.adapter, io: { read: async () => ({ content: 'v1' }), write: async () => ({ ok: true }) } })
  await host.load()
  await host.save()
  assert.ok(host.getState().notices.some(n => /timing heuristic/.test(n.text)))
})

test('dispose is terminal and a later load is refused rather than resurrecting the viewer', async () => {
  const ed = fakeEditor()
  let destroyed = false
  const host = createEditorHost({ adapter: { ...ed.adapter, destroy: () => { destroyed = true } }, io: { read: async () => ({ content: 'v' }) } })
  await host.load()
  host.dispose()
  assert.equal(destroyed, true)
  const r = await host.load()
  assert.equal(r.ok, false)
  assert.match(r.reason, /closed/)
})

test('subscribers see state changes and a throwing subscriber cannot break the host', async () => {
  const ed = fakeEditor()
  const seen = []
  const host = createEditorHost({ adapter: ed.adapter, io: { read: async () => ({ content: 'v' }) } })
  host.subscribe(() => { throw new Error('bad subscriber') })
  host.subscribe(s => seen.push(s.status))
  await assert.doesNotReject(() => host.load())
  assert.ok(seen.includes('ready'))
})
