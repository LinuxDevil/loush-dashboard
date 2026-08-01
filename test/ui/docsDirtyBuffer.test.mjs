// The three dirty-buffer protections in DocsSection, rendered.
//
// These were recorded as "no automated test" on the reasoning that they are one-line predicates and
// that the real risk — a predicate not WIRED to the control it guards — needs a render harness this
// repo does not have. The first half of that is right, and it is exactly why a predicate-only test
// would have been worthless. The second half is not: see test/ui/harness/jsx.mjs. So this renders
// the real DocsSection over the real AiEditBar, DocList and ProposalReview, and drives it through
// the DOM.
//
// What each test protects:
//   1. the AI-edit bar is DISABLED while the buffer is dirty — because /api/docs/ai-edit builds its
//      proposal from the file on DISK, so accepting a whole-document diff computed against a stale
//      baseline reverts every unsaved edit;
//   2. `runAiEdit` refuses anyway if a race gets past the disabled control — asserted by the request
//      never being made, not by reading the guard;
//   3. accepting a proposal CONFIRMS if the buffer changed while the model worked, and dropping
//      those keystrokes requires saying yes;
//   4. switching files with unsaved work confirms too, which is the same rule on the fourth path.
//
// Only DocEditor is stubbed, and only because CodeMirror needs real layout. Everything between the
// component under test and that stub is the shipping code.

import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { installDom, mock, mount, q } from './harness/jsx.mjs'

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../src')

// A textarea in place of CodeMirror: same contract (`value`, `onChange`), no layout engine.
mock(path.join(SRC, 'sections/docs/DocEditor.jsx'), {
  default: function DocEditorStub({ value, onChange }) {
    return globalThis.__React.createElement('textarea', {
      className: 'doc-editor-stub', value, onChange: e => onChange(e.target.value),
    })
  },
})

const FILE = 'note.md'
const OTHER = 'other.md'
const DISK = { [FILE]: '# note\n\nhello\n', [OTHER]: '# other\n' }

let dom, confirms, setConfirmAnswer, React, requests, held

before(async () => {
  const d = await installDom()
  dom = d; confirms = d.confirms; setConfirmAnswer = d.setConfirmAnswer
  React = (await import('react')).default
  globalThis.__React = React

  // Every request the section makes is recorded and answered here. `held` lets a test keep the
  // ai-edit response open, which is the only way to type "while the model is working".
  requests = []
  held = new Map()
  const route = url => {
    if (url.startsWith('/api/docs?') || url === '/api/docs') {
      return { root: '/docs', files: Object.keys(DISK).map((p, i) => ({ path: p, bytes: DISK[p].length, mtime: 2 - i })) }
    }
    if (url.startsWith('/api/docs/file')) {
      const p = decodeURIComponent(new URL(url, 'http://x').searchParams.get('path'))
      return { path: p, text: DISK[p], bytes: DISK[p].length, mtime: 1 }
    }
    if (url === '/api/docs/ai-edit') {
      return held.get('ai-edit') || { path: FILE, text: 'PROPOSED', selection: null, wrote: false, cost: 0 }
    }
    return {}
  }
  globalThis.fetch = async (url, opts) => {
    const method = opts?.method || 'GET'
    requests.push({ url, method, body: opts?.body ? JSON.parse(opts.body) : null })
    const json = method === 'PUT' ? { ok: true, path: FILE, bytes: 1, mtime: 2 } : await route(url)
    return { ok: true, status: 200, headers: new Map(), json: async () => json }
  }
})

after(() => { dom?.window?.close() })

const rowFor = (m, file) => q.all(m.container, '.docs-row').find(n => n.getAttribute('title') === file)
const click = (m, el) => m.act(async () => {
  el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
  await new Promise(r => setTimeout(r, 0))
})
const editor = m => m.container.querySelector('.doc-editor-stub')
const instructionBox = m => m.container.querySelector('.docs-ai-bar input')
const aiButton = m => q.button(m.container, 'AI edit')

/** Mount the section and open the first file, leaving a clean saved buffer. */
async function openDoc() {
  requests.length = 0
  confirms.length = 0
  setConfirmAnswer(false)
  const DocsSection = (await import('../../src/sections/DocsSection.jsx')).default
  const m = await mount(React.createElement(DocsSection))
  const row = rowFor(m, FILE)
  assert.ok(row, 'the file row should be listed')
  await click(m, row)
  assert.ok(editor(m), 'the editor should be showing after the file loads')
  assert.equal(editor(m).value, DISK[FILE])
  // The bar also refuses an empty instruction, which is a different rule and would otherwise mask
  // the one under test. Fill it once here so every assertion below is about the buffer.
  await setValue(m, instructionBox(m), 'tighten this')
  return m
}

// React installs its own `value` setter on the DOM node, so assigning `el.value` is invisible to
// it. The prototype setter is the documented way to make a controlled input see a change.
async function setValue(m, el, text) {
  const proto = el.tagName === 'TEXTAREA' ? dom.window.HTMLTextAreaElement : dom.window.HTMLInputElement
  const setter = Object.getOwnPropertyDescriptor(proto.prototype, 'value').set
  await m.act(async () => {
    setter.call(el, text)
    el.dispatchEvent(new dom.window.Event('input', { bubbles: true }))
  })
}
const type = (m, text) => setValue(m, editor(m), text)

/** Invoke `runAiEdit` itself, bypassing the disabled control. See the test that uses it for why. */
async function fireAiRun(m) {
  const btn = aiButton(m)
  const key = Object.keys(btn).find(k => k.startsWith('__reactProps$'))
  assert.ok(key, 'the React props record should be reachable on the DOM node')
  assert.equal(typeof btn[key].onClick, 'function')
  await m.act(async () => { btn[key].onClick(); await new Promise(r => setTimeout(r, 0)) })
}

// ------------------------------------------------------------------------------------------- 1

test('the AI-edit bar is enabled on a saved buffer and DISABLED the moment it goes dirty', async () => {
  const m = await openDoc()
  assert.equal(aiButton(m).disabled, false, 'a saved buffer may be AI-edited')

  await type(m, DISK[FILE] + 'unsaved words')

  assert.equal(m.container.querySelector('.docs-state').textContent, 'unsaved changes')
  assert.equal(aiButton(m).disabled, true, 'the control must be disabled, not merely guarded behind it')
  // The reason is shown, because a greyed-out button with no explanation reads as broken.
  assert.match(m.container.textContent, /save first/)
  assert.match(aiButton(m).getAttribute('title') || '', /save first/)

  // …and it comes back once the buffer matches disk again.
  await type(m, DISK[FILE])
  assert.equal(m.container.querySelector('.docs-state').textContent, 'saved')
  assert.equal(aiButton(m).disabled, false)
  await m.unmount()
})

// ------------------------------------------------------------------------------------------- 2

test('runAiEdit refuses on a dirty buffer even when the disabled control is bypassed', async () => {
  const m = await openDoc()
  await type(m, DISK[FILE] + 'unsaved words')

  // The handler has to be called directly, and the first attempt at this test was wrong in a way
  // worth recording: clearing the DOM `disabled` attribute and clicking does NOT reach it. React
  // filters mouse events on form elements using the FIBER's props, not the node's attributes, so
  // that version passed with the guard deleted — a test that asserted nothing.
  //
  // `onRun` is `runAiEdit` and is installed as the button's onClick, so React's own props record is
  // where the real handler lives. Calling it with the buffer dirty is exactly the state a race
  // would produce: the control said no, the handler ran anyway.
  const before = requests.filter(r => r.url === '/api/docs/ai-edit').length
  await fireAiRun(m)

  assert.equal(requests.filter(r => r.url === '/api/docs/ai-edit').length, before,
    'no ai-edit request may be made against a dirty buffer')
  assert.match(m.container.textContent, /save first/, 'and the refusal is reported to the user')

  // The same call DOES reach the network once the buffer matches disk, so the assertion above is
  // about the guard rather than about the handler being unreachable.
  await type(m, DISK[FILE])
  await fireAiRun(m)
  assert.equal(requests.filter(r => r.url === '/api/docs/ai-edit').length, before + 1)
  await m.unmount()
})

// ------------------------------------------------------------------------------------------- 3

test('accepting a proposal after typing asks first, and NO means the keystrokes survive', async () => {
  const m = await openDoc()

  // Hold the ai-edit response open so there is a window in which to type.
  let release
  held.set('ai-edit', new Promise(r => { release = r }))
  await m.act(async () => {
    aiButton(m).dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }))
    await new Promise(r => setTimeout(r, 0))
  })
  assert.equal(requests.filter(r => r.url === '/api/docs/ai-edit').length, 1, 'a clean buffer does send')

  const typedWhileWorking = DISK[FILE] + '\nwords typed while the model was working\n'
  await type(m, typedWhileWorking)

  await m.act(async () => {
    release({ path: FILE, text: 'PROPOSED', selection: null, wrote: false, cost: 0 })
    await new Promise(r => setTimeout(r, 0))
  })
  held.delete('ai-edit')

  const accept = q.all(m.container, 'button').find(b => /accept/i.test(b.textContent))
  assert.ok(accept, 'the proposal review should offer accept')

  // NO — the buffer must be left exactly as typed.
  setConfirmAnswer(false)
  confirms.length = 0
  await click(m, accept)
  assert.equal(confirms.length, 1, 'a stale proposal must ask before discarding keystrokes')
  assert.match(confirms[0], /typed since this proposal was requested/)
  assert.equal(editor(m).value, typedWhileWorking, 'declining must leave every keystroke in place')

  // YES — the proposal replaces the buffer, and only then.
  setConfirmAnswer(true)
  await click(m, accept)
  assert.equal(confirms.length, 2)
  assert.equal(editor(m).value, 'PROPOSED')
  await m.unmount()
})

test('accepting a proposal the user did NOT type over applies without asking', async () => {
  const m = await openDoc()
  await click(m, aiButton(m))
  const accept = q.all(m.container, 'button').find(b => /accept/i.test(b.textContent))
  assert.ok(accept, 'the proposal review should offer accept')
  confirms.length = 0
  await click(m, accept)
  assert.deepEqual(confirms, [], 'nothing was typed, so there is nothing to warn about')
  assert.equal(editor(m).value, 'PROPOSED')
  await m.unmount()
})

test('rejecting a proposal leaves the buffer alone and writes nothing', async () => {
  const m = await openDoc()
  await click(m, aiButton(m))
  const reject = q.all(m.container, 'button').find(b => /reject|discard/i.test(b.textContent))
  assert.ok(reject, 'the proposal review should offer reject')
  const puts = requests.filter(r => r.method === 'PUT').length
  await click(m, reject)
  assert.equal(editor(m).value, DISK[FILE])
  assert.equal(requests.filter(r => r.method === 'PUT').length, puts, 'reject writes nothing')
  await m.unmount()
})

// ------------------------------------------------------------------------------------------- 4

test('switching files with unsaved work asks, and NO keeps the buffer on the first file', async () => {
  const m = await openDoc()
  const typed = DISK[FILE] + 'unsaved words'
  await type(m, typed)

  confirms.length = 0
  setConfirmAnswer(false)
  await click(m, rowFor(m, OTHER))
  assert.equal(confirms.length, 1, 'switching away from a dirty buffer must ask')
  assert.match(confirms[0], /unsaved changes/)
  assert.equal(editor(m).value, typed, 'declining keeps the buffer, and the file, where they were')
  assert.match(m.container.querySelector('.path').textContent, new RegExp(FILE))

  // YES — the other file opens and the buffer is replaced.
  setConfirmAnswer(true)
  await click(m, rowFor(m, OTHER))
  assert.equal(confirms.length, 2)
  assert.equal(editor(m).value, DISK[OTHER])
  await m.unmount()
})

test('a clean buffer switches files without asking', async () => {
  const m = await openDoc()
  confirms.length = 0
  await click(m, rowFor(m, OTHER))
  assert.deepEqual(confirms, [], 'nothing was unsaved, so there is nothing to warn about')
  assert.equal(editor(m).value, DISK[OTHER])
  await m.unmount()
})
