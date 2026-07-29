import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeColor, parsePx, rank, rankColors, rankSpacing, detectTheme, collectBreakpoints, summarize } from '../../lib/page-style.mjs'
import { assertCapturableUrl, contextMarkdown } from '../../server/page-capture.mjs'

test('the same colour written different ways folds to one token', () => {
  assert.equal(normalizeColor('rgb(255, 255, 255)').key, '#ffffff')
  assert.equal(normalizeColor('#fff').key, '#ffffff')
  assert.equal(normalizeColor('#FFFFFF').key, '#ffffff')
  assert.equal(normalizeColor('rgba(255, 255, 255, 1)').key, '#ffffff')
})

test('alpha is kept distinct — a translucent overlay is not its opaque colour', () => {
  assert.equal(normalizeColor('rgba(0, 0, 0, 0.5)').key, '#000000@0.5')
  assert.equal(normalizeColor('rgba(0, 0, 0, 0)').key, 'transparent')
  assert.equal(normalizeColor('transparent').key, 'transparent')
})

test('an unparseable colour is kept verbatim rather than dropped', () => {
  const g = normalizeColor('linear-gradient(red, blue)')
  assert.equal(g.hex, null)
  assert.ok(g.key.includes('linear-gradient'))
})

test('only px values rank as spacing', () => {
  assert.equal(parsePx('16px'), 16)
  assert.equal(parsePx('1.5px'), 1.5)
  assert.equal(parsePx('50%'), null)
  assert.equal(parsePx('auto'), null)
})

test('ranking orders by usage and reports each value as a share of the whole', () => {
  const out = rank({ a: 30, b: 60, c: 10 })
  assert.deepEqual(out.map(r => r.value), ['b', 'a', 'c'])
  assert.equal(out[0].share, 0.6)
})

test('equivalent colour notations are summed before ranking, not counted apart', () => {
  const out = rankColors({ '#fff': 5, 'rgb(255, 255, 255)': 5, 'rgb(0, 0, 0)': 2 })
  assert.equal(out[0].value, '#ffffff')
  assert.equal(out[0].count, 10)
})

test('zero spacing is excluded and the scale comes back in ascending order', () => {
  const out = rankSpacing({ '0px': 900, '8px': 40, '16px': 90, '4px': 12 })
  assert.deepEqual(out.map(r => r.value), ['4px', '8px', '16px'])
})

test('theme comes from the body background, not an element headcount', () => {
  const counts = { 'rgb(47, 111, 235)': 4, 'rgb(255, 255, 255)': 4, 'rgb(26, 26, 26)': 1 }
  const t = detectTheme(counts, 'rgb(255, 255, 255)')
  assert.equal(t.theme, 'light')
  assert.equal(t.basis, '#ffffff')
  assert.equal(t.from, 'body')
})

test('a genuinely dark page is still read as dark', () => {
  assert.equal(detectTheme({ 'rgb(18, 18, 18)': 100 }, 'rgb(18, 18, 18)').theme, 'dark')
})

test('the background histogram is the fallback when the body is transparent', () => {
  const t = detectTheme({ 'rgb(18, 18, 18)': 100, 'rgb(255,255,255)': 3 }, 'rgba(0, 0, 0, 0)')
  assert.equal(t.theme, 'dark')
  assert.equal(t.from, 'dominant')
})

test('an unknown theme reads as unknown rather than defaulting to light', () => {
  assert.equal(detectTheme({}).theme, null)
  assert.equal(detectTheme({ transparent: 50 }, null).theme, null)
})

test('breakpoints are deduped, unit-converted and ordered', () => {
  const out = collectBreakpoints([
    'screen and (min-width: 768px)',
    '(min-width: 768px)',
    '(max-width: 48rem)',
    '(min-width: 1200px)',
  ])
  assert.deepEqual(out.map(b => `${b.type}-${b.px}`), ['max-768', 'min-768', 'min-1200'])
})

test('summarize survives an empty capture without throwing', () => {
  const s = summarize({})
  assert.equal(s.theme.theme, null)
  assert.deepEqual(s.spacing, [])
  assert.equal(s.variableCount, 0)
})

test('loopback and private addresses are refused by default', () => {
  for (const bad of ['http://localhost:5178/api/usage', 'http://127.0.0.1/', 'http://[::1]/', 'http://192.168.1.1/', 'http://10.0.0.5/', 'http://169.254.169.254/']) {
    assert.throws(() => assertCapturableUrl(bad, { allowLocal: false }), /loopback|private/, `should refuse ${bad}`)
  }
})

test('the local-capture opt-in is required to reach a dev server, and only lifts the host rule', () => {
  assert.equal(assertCapturableUrl('http://localhost:3000/', { allowLocal: true }), 'http://localhost:3000/')
  assert.throws(() => assertCapturableUrl('file:///etc/passwd', { allowLocal: true }), /http/)
})

test('non-http schemes are refused', () => {
  assert.throws(() => assertCapturableUrl('file:///etc/passwd'), /http/)
  assert.throws(() => assertCapturableUrl('not a url'), /valid URL/)
})

test('ordinary public URLs are accepted', () => {
  assert.equal(assertCapturableUrl('https://example.com/x'), 'https://example.com/x')
})

test('context markdown reports an empty capture honestly instead of inventing values', () => {
  const md = contextMarkdown({ frameName: 'Empty', url: 'https://example.com', styleSummary: summarize({}), nodeTree: [], interactionStates: [] })
  assert.match(md, /reads as \*\*unknown\*\*/)
  assert.match(md, /_none captured_/)
  assert.doesNotMatch(md, /undefined/)
})
