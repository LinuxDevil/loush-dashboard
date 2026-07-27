// Tests for lib/adf.mjs.
//
// The headline case is `[object Object]`: JIRA comment bodies arrive as ADF, server/eng.mjs passed
// them to htmlToText() whose first act is String(html), and the resulting literal string was fed
// into every acceptance-criteria and test-case prompt. That regression is pinned first and
// explicitly, because it was invisible — the generated output still looked well-formed.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { adfToText, isAdf, markdownToAdf } from '../../lib/adf.mjs'

const doc = (...content) => ({ type: 'doc', version: 1, content })
const para = (...t) => ({ type: 'paragraph', content: t.map(x => (typeof x === 'string' ? { type: 'text', text: x } : x)) })
const txt = s => ({ type: 'text', text: s })

// ── the regression this module exists for ────────────────────────────────────────────────────────
test('ADF comment body does not stringify to [object Object]', () => {
  const body = doc(para('The retry must be idempotent.'))
  const { text } = adfToText(body)
  assert.equal(text, 'The retry must be idempotent.')
  assert.ok(!text.includes('[object Object]'))
})

test('the old htmlToText path is what produced [object Object] — proving the bug was real', () => {
  // htmlToText's first act, reproduced: String(adfObject).
  assert.equal(String(doc(para('hi'))), '[object Object]')
})

test('isAdf distinguishes an ADF doc from rendered HTML', () => {
  assert.equal(isAdf(doc(para('x'))), true)
  assert.equal(isAdf('<p>x</p>'), false)
  assert.equal(isAdf(null), false)
  assert.equal(isAdf({ type: 'doc' }), false)     // no content array
  assert.equal(isAdf([para('x')]), false)
})

test('a string passes through untouched — rendered HTML is not this module job', () => {
  assert.equal(adfToText('already text').text, 'already text')
  assert.deepEqual(adfToText(null), { text: '', warnings: [] })
})

// ── structure that carries requirements ──────────────────────────────────────────────────────────
test('nested bullet lists keep their nesting', () => {
  const d = doc({
    type: 'bulletList',
    content: [
      { type: 'listItem', content: [para('outer')] },
      {
        type: 'listItem',
        content: [para('parent'), { type: 'bulletList', content: [{ type: 'listItem', content: [para('child')] }] }],
      },
    ],
  })
  const { text } = adfToText(d)
  assert.equal(text, '• outer\n• parent\n  • child')
})

test('ordered lists number from attrs.order', () => {
  const d = doc({
    type: 'orderedList',
    attrs: { order: 3 },
    content: [{ type: 'listItem', content: [para('third')] }, { type: 'listItem', content: [para('fourth')] }],
  })
  assert.equal(adfToText(d).text, '3. third\n4. fourth')
})

test('taskList survives — it is where acceptance criteria are actually written', () => {
  const d = doc({
    type: 'taskList',
    content: [
      { type: 'taskItem', attrs: { state: 'DONE' }, content: [txt('handles empty input')] },
      { type: 'taskItem', attrs: { state: 'TODO' }, content: [txt('handles 429 from JIRA')] },
    ],
  })
  assert.equal(adfToText(d).text, '- [x] handles empty input\n- [ ] handles 429 from JIRA')
})

test('a requirement stated in a table cell is not lost', () => {
  const cell = (type, s) => ({ type, content: [para(s)] })
  const d = doc({
    type: 'table',
    content: [
      { type: 'tableRow', content: [cell('tableHeader', 'Field'), cell('tableHeader', 'Rule')] },
      { type: 'tableRow', content: [cell('tableCell', 'email'), cell('tableCell', 'must be unique')] },
    ],
  })
  const { text } = adfToText(d)
  assert.ok(text.includes('must be unique'), text)
  assert.ok(text.includes('| --- | --- |'), text)   // header separator emitted
})

test('code blocks keep their fence and language', () => {
  const d = doc({ type: 'codeBlock', attrs: { language: 'js' }, content: [txt('const a = 1')] })
  assert.equal(adfToText(d).text, '```js\nconst a = 1\n```')
})

test('panels are labelled rather than flattened into prose', () => {
  const d = doc({ type: 'panel', attrs: { panelType: 'warning' }, content: [para('do not ship on Friday')] })
  assert.equal(adfToText(d).text, '[warning] do not ship on Friday')
})

test('inline marks: code is marked, links keep their href', () => {
  const d = doc(para(
    { type: 'text', text: 'retry()', marks: [{ type: 'code' }] },
    { type: 'text', text: ' see spec', marks: [{ type: 'link', attrs: { href: 'https://x/y' } }] },
  ))
  assert.equal(adfToText(d).text, '`retry()` see spec (https://x/y)')
})

test('a mention with no resolved text is named, not silently emptied', () => {
  assert.equal(adfToText(doc(para({ type: 'mention', attrs: { text: '@ali' } }))).text, '@ali')
  assert.equal(adfToText(doc(para({ type: 'mention', attrs: { id: 'acc-1' } }))).text, '@unknown')
})

test('headings, rules and blockquotes render', () => {
  const d = doc(
    { type: 'heading', attrs: { level: 2 }, content: [txt('Scope')] },
    { type: 'blockquote', content: [para('out of scope: mobile')] },
    { type: 'rule' },
  )
  assert.equal(adfToText(d).text, '## Scope\n> out of scope: mobile\n---')
})

// ── honesty: never drop content silently ─────────────────────────────────────────────────────────
test('an unknown wrapper node recurses instead of dropping its text', () => {
  const d = doc({ type: 'someFutureBlock', content: [para('still important')] })
  const { text, warnings } = adfToText(d)
  assert.equal(text, 'still important')
  assert.deepEqual(warnings, [])   // nothing was lost, so nothing is warned about
})

test('a childless unknown node is reported in warnings rather than vanishing', () => {
  const { text, warnings } = adfToText(doc(para('a'), { type: 'mysteryWidget' }))
  assert.equal(text, 'a')
  assert.ok(warnings.includes('mysteryWidget'), JSON.stringify(warnings))
})

test('media is reported as omitted', () => {
  const { warnings } = adfToText(doc({ type: 'mediaSingle', content: [{ type: 'media', attrs: { id: 'x' } }] }))
  assert.ok(warnings.includes('media'), JSON.stringify(warnings))
})

// ── markdown -> ADF (posting back to JIRA) ───────────────────────────────────────────────────────
test('markdownToAdf always returns a legal document', () => {
  const empty = markdownToAdf('')
  assert.equal(empty.type, 'doc')
  assert.equal(empty.version, 1)
  assert.equal(empty.content.length, 1)   // an empty content array is rejected by JIRA
})

test('markdownToAdf maps headings, bullets, ordered lists and code', () => {
  const adf = markdownToAdf('## AC\n\n- one\n- two\n\n1. first\n\n```js\nx\n```\n\nplain text')
  const types = adf.content.map(n => n.type)
  assert.deepEqual(types, ['heading', 'bulletList', 'orderedList', 'codeBlock', 'paragraph'])
  assert.equal(adf.content[0].attrs.level, 2)
  assert.equal(adf.content[1].content.length, 2)
  assert.equal(adf.content[3].attrs.language, 'js')
})

test('markdown -> ADF -> text round-trips the meaning', () => {
  const md = '# Title\n\n- alpha\n- beta'
  assert.equal(adfToText(markdownToAdf(md)).text, '# Title\n• alpha\n• beta')
})

test('an unterminated code fence still yields its content', () => {
  const adf = markdownToAdf('```\nunclosed')
  assert.equal(adf.content[0].type, 'codeBlock')
  assert.equal(adf.content[0].content[0].text, 'unclosed')
})
