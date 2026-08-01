// A React render harness for `node --test`, built only from what package.json already installs.
//
// It exists because the previous verification recorded "JSX will not load under plain `node --test`"
// and closed a coverage gap on that basis. The statement is true of a bare `import` and false of the
// tooling in this repo:
//
//   · `node:module`'s `registerHooks` installs a SYNCHRONOUS, in-thread load hook, so a transform can
//     rewrite a module's source before the runtime parses it. The older `register()` loader ran on a
//     worker thread and could not share objects with the test, which is probably where the belief
//     came from.
//   · `esbuild` is already installed — it is Vite's own transformer and Vite is a devDependency. So
//     the JSX pass here is the pass the app ships with, not an approximation of it.
//   · `jsdom` and `react-dom` are already dependencies.
//
// No new package. The point is that a test can render the REAL component tree, instead of restating
// its logic in the test file the way `test/ui/chatBlocks.test.mjs` has to.
//
// `mock()` is for leaves only — CodeMirror wants real browser layout. Everything between the
// component under test and those leaves is the real code, because the bug worth catching is a
// predicate that is correct but not WIRED to the control it guards, and only a render sees that.

import { registerHooks } from 'node:module'
import { readFileSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { transformSync } from 'esbuild'

const BAG = '__jsxHarnessMocks__'
const mocks = globalThis[BAG] = new Map()   // resolved file URL -> module object

/**
 * Replace one module for every importer. Keyed by ABSOLUTE PATH, not by specifier, because the same
 * file is spelled `../lib/api.js` from one directory and `../../lib/api.js` from another.
 * Call before the dynamic `import()` that pulls in the tree.
 */
export function mock(absPath, moduleObject) {
  mocks.set(pathToFileURL(absPath).href, moduleObject)
}

registerHooks({
  load(url, context, next) {
    // A load hook returns SOURCE TEXT, so a mock is delivered as a generated module that reads the
    // live object back out of a global. Exports must be named statically, hence the key scan.
    if (mocks.has(url)) {
      const keys = Object.keys(mocks.get(url))
      const src = [
        `const m = globalThis[${JSON.stringify(BAG)}].get(${JSON.stringify(url)});`,
        ...keys.filter(k => k !== 'default').map(k => `export const ${k} = m[${JSON.stringify(k)}];`),
        keys.includes('default') ? 'export default m.default;' : '',
      ].join('\n')
      return { format: 'module', source: src, shortCircuit: true }
    }
    if (!url.startsWith('file:') || !url.endsWith('.jsx')) return next(url, context)
    const file = fileURLToPath(url)
    const { code } = transformSync(readFileSync(file, 'utf8'), {
      loader: 'jsx', format: 'esm', sourcefile: file, jsx: 'automatic',
    })
    return { format: 'module', source: code, shortCircuit: true }
  },
})

/**
 * A DOM as globals, plus the two browser APIs this app calls that jsdom declines to implement.
 * Returns the recorders for both so a test can assert on them.
 */
export async function installDom() {
  const { JSDOM } = await import('jsdom')
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>',
    { url: 'http://localhost/', pretendToBeVisual: true })
  const w = dom.window
  for (const k of ['window', 'document', 'navigator', 'HTMLElement', 'HTMLInputElement',
    'HTMLTextAreaElement', 'Element', 'Node', 'Event', 'MouseEvent', 'KeyboardEvent', 'CustomEvent',
    'DocumentFragment', 'Text', 'Range', 'NodeFilter', 'DOMParser', 'MutationObserver',
    'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
    if (globalThis[k] === undefined && w[k] !== undefined) globalThis[k] = w[k]
  }
  globalThis.IS_REACT_ACT_ENVIRONMENT = true

  // jsdom throws "not implemented" for confirm. The dirty-buffer rules ARE confirm prompts, so the
  // recorder is the assertion surface, not a convenience.
  const confirms = []
  let answer = false
  w.confirm = message => { confirms.push(message); return answer }
  globalThis.confirm = w.confirm

  return { dom, window: w, confirms, setConfirmAnswer: v => { answer = v } }
}

/** Mount a component and return `{ root, container, act, rerender, unmount }`. */
export async function mount(element) {
  const React = (await import('react')).default
  const { createRoot } = await import('react-dom/client')
  const { act } = await import('react')
  // A fresh container per mount: React warns, loudly and correctly, if one root is created twice
  // over the same node, and a stale root would leak state between tests.
  const container = globalThis.document.createElement('div')
  globalThis.document.getElementById('root').appendChild(container)
  const root = createRoot(container)
  await act(async () => { root.render(element) })
  return {
    container,
    React,
    act,
    rerender: async el => { await act(async () => { root.render(el) }) },
    unmount: async () => { await act(async () => { root.unmount() }) },
  }
}

/** Every DOM query these tests need, so the tests read as behaviour rather than as selectors. */
export const q = {
  byText: (el, text) => [...el.querySelectorAll('*')].find(n => n.textContent.trim() === text),
  button: (el, label) => [...el.querySelectorAll('button')].find(b => b.textContent.trim() === label),
  all: (el, sel) => [...el.querySelectorAll(sel)],
}

export { pathToFileURL }
