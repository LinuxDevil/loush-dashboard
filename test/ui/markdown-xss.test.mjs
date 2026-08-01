import test from 'node:test'
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { marked } from 'marked'
import createDOMPurify from 'dompurify'

// Mirrors src/ui/Markdown.jsx's configuration. It is restated rather than imported because the
// component is JSX and pulls in React; the point of this file is to prove the SANITISER config
// blocks real payloads, so any divergence between the two is itself the regression to catch.
const window = new JSDOM('').window
const DOMPurify = createDOMPurify(window)
DOMPurify.addHook('afterSanitizeAttributes', node => {
  if (node.tagName === 'A' && node.hasAttribute('href')) {
    node.setAttribute('target', '_blank')
    node.setAttribute('rel', 'noopener noreferrer')
  }
})
const OPTIONS = {
  USE_PROFILES: { html: true },
  ALLOWED_URI_REGEXP: /^(?:https?|mailto|ftp|tel|#|\/|\.\/|\.\.\/)/i,
  FORBID_TAGS: ['style', 'form', 'input', 'button', 'iframe', 'object', 'embed', 'script'],
  FORBID_ATTR: ['style', 'srcset', 'formaction', 'form'],
}
const render = src => DOMPurify.sanitize(marked.parse(src), OPTIONS)

// Every payload below is markdown a model could emit, or that could sit in a .md file an agent
// read. Before this component they all reached innerHTML intact: marked has not sanitised since
// v5, and eight call sites piped it straight into dangerouslySetInnerHTML.
const PAYLOADS = [
  ['inline script', '<script>window.__pwned=1</script>'],
  ['img onerror', '<img src=x onerror="window.__pwned=1">'],
  ['svg onload', '<svg onload="window.__pwned=1"></svg>'],
  ['javascript: link', '[click](javascript:window.__pwned=1)'],
  ['iframe', '<iframe src="https://evil.example"></iframe>'],
  ['body onload', '<body onload="window.__pwned=1">'],
  ['details ontoggle', '<details open ontoggle="window.__pwned=1">x</details>'],
  ['form action', '<form action="https://evil.example"><input name=a></form>'],
  ['data URI html link', '<a href="data:text/html;base64,PHNjcmlwdD4x">x</a>'],
  ['object tag', '<object data="https://evil.example"></object>'],
]

for (const [name, payload] of PAYLOADS) {
  test(`markdown sanitiser neutralises: ${name}`, () => {
    const html = render(payload)
    assert.doesNotMatch(html, /<script/i, 'a script tag survived')
    assert.doesNotMatch(html, /\son\w+\s*=/i, 'an inline event handler survived')
    assert.doesNotMatch(html, /javascript:/i, 'a javascript: URI survived')
    assert.doesNotMatch(html, /<iframe|<object|<embed|<form/i, 'an executable/embedding tag survived')
    assert.doesNotMatch(html, /data:text\/html/i, 'a data: HTML URI survived')
  })
}

test('ordinary markdown still renders as markdown', () => {
  // A sanitiser that eats legitimate content would just get removed again, so this pins that the
  // safe path still works.
  const html = render('# Title\n\nSome **bold** text and `code`.\n\n- one\n- two\n')
  assert.match(html, /<h1/)
  assert.match(html, /<strong>bold<\/strong>/)
  assert.match(html, /<code>code<\/code>/)
  assert.match(html, /<li>one<\/li>/)
})

test('external links cannot reach back through window.opener', () => {
  const html = render('[docs](https://example.com)')
  assert.match(html, /rel="noopener noreferrer"/, 'a new-tab link without noopener hands the opener a window reference')
  assert.match(html, /target="_blank"/)
})
