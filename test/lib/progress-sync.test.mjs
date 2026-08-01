import test from 'node:test'
import assert from 'node:assert/strict'
import { renderProgress, withMarker, buildMarker, parseMarker, planSync, bodyHash, SECTIONS } from '../../lib/progress-sync.mjs'

const comment = (id, body) => ({ id, body })

test('all six sections render, in a fixed order', () => {
  const { body } = renderProgress('ABC-1', { status: 'On track' })
  const order = SECTIONS.map(([, title]) => body.indexOf(`### ${title}`))
  assert.ok(order.every(i => i >= 0), 'every section must be present')
  assert.deepEqual(order, [...order].sort((a, b) => a - b), 'sections must keep their declared order')
})

test('an empty section says "none" and an unsupplied one says "not determined"', () => {
  const { body } = renderProgress('ABC-1', { blocked: [], next: null })
  assert.match(body, /### Blocked\n_none_/)
  assert.match(body, /### Next\n_not determined_/)
})

test('"nothing is blocked" and "we did not check" are not the same claim', () => {
  const checked = renderProgress('A', { blocked: [] }).body
  const unchecked = renderProgress('A', {}).body
  assert.notEqual(checked, unchecked)
})

test('arrays render as bullets and strings pass through', () => {
  const { body } = renderProgress('ABC-1', { done: ['merged #12', 'shipped'], status: 'On track' })
  assert.match(body, /- merged #12\n- shipped/)
  assert.match(body, /### Status\nOn track/)
})

test('whitespace-only content is treated as empty, not as content', () => {
  assert.match(renderProgress('A', { status: '   ' }).body, /### Status\n_none_/)
})

// ---- marker ----

test('a marker round-trips', () => {
  const m = parseMarker(buildMarker('ABC-1', 'deadbeef1234'))
  assert.deepEqual(m, { key: 'ABC-1', hash: 'deadbeef1234' })
})

test('an unmarked comment yields no marker, so a human comment is never claimed as ours', () => {
  for (const body of ['just a normal comment', '', null, undefined, '<!-- something else -->', '<!-- loush:other key=A -->']) {
    assert.equal(parseMarker(body), null, JSON.stringify(body))
  }
})

test('a marker is found even when the body has content around it', () => {
  const { body } = withMarker('ABC-1', { status: 'On track' })
  assert.equal(parseMarker(body).key, 'ABC-1')
  assert.ok(body.includes('### Status'), 'the marker does not replace the content')
})

test('the marker hash matches the body it was built from', () => {
  const { body, hash } = withMarker('ABC-1', { status: 'x' })
  assert.equal(parseMarker(body).hash, hash)
  assert.equal(hash, bodyHash(renderProgress('ABC-1', { status: 'x' }).body))
})

test('a key with injection characters cannot break out of the marker', () => {
  const m = buildMarker('AB --> <script>alert(1)</script>', 'abc')
  assert.ok(!m.includes('<script'))
  assert.equal((m.match(/-->/g) || []).length, 1)
})

// ---- plan ----

test('no existing progress comment means create', () => {
  const p = planSync([comment(1, 'unrelated'), comment(2, 'also unrelated')], 'ABC-1', 'h1')
  assert.equal(p.action, 'create')
})

test('an existing comment with a different hash means update, targeting it by id', () => {
  const p = planSync([comment(7, 'old body ' + buildMarker('ABC-1', 'old'))], 'ABC-1', 'new')
  assert.equal(p.action, 'update')
  assert.equal(p.commentId, 7)
  assert.equal(p.previousHash, 'old')
})

test('an unchanged body means skip — no edit, no notification', () => {
  const p = planSync([comment(7, 'body ' + buildMarker('ABC-1', 'same'))], 'ABC-1', 'same')
  assert.equal(p.action, 'skip')
  assert.equal(p.commentId, 7)
  assert.match(p.detail, /notify watchers for nothing/)
})

test('running twice with the same input is a no-op the second time', () => {
  const { body, hash } = withMarker('ABC-1', { status: 'On track', done: ['a'] })
  assert.equal(planSync([], 'ABC-1', hash).action, 'create')
  assert.equal(planSync([comment(1, body)], 'ABC-1', hash).action, 'skip')
})

test('a marker for a DIFFERENT ticket is not ours to overwrite', () => {
  const p = planSync([comment(7, buildMarker('OTHER-9', 'h'))], 'ABC-1', 'h')
  assert.equal(p.action, 'create')
})

test('unreadable comments are refused, not blind-posted', () => {
  for (const bad of [null, undefined, 'nope', 42, {}]) {
    const p = planSync(bad, 'ABC-1', 'h')
    assert.equal(p.action, 'refuse', JSON.stringify(bad))
    assert.equal(p.reason, 'existing-comments-unreadable')
    assert.ok(p.detail, 'a refusal must say why')
  }
})

test('duplicates from an earlier blind post are named, not silently left behind', () => {
  const p = planSync([
    comment(1, buildMarker('ABC-1', 'a')),
    comment(2, buildMarker('ABC-1', 'b')),
    comment(3, buildMarker('ABC-1', 'c')),
  ], 'ABC-1', 'z')
  assert.equal(p.action, 'update')
  assert.equal(p.commentId, 3, 'the newest is the live one')
  assert.deepEqual(p.duplicates, [1, 2])
})

test('a provider with a different comment shape works through the accessors', () => {
  const jira = [{ id: '10001', body: { text: buildMarker('ABC-1', 'old') } }]
  const p = planSync(jira, 'ABC-1', 'new', { bodyOf: c => c.body.text })
  assert.equal(p.action, 'update')
  assert.equal(p.commentId, '10001')
})

test('an empty comment list means create, which is different from an unreadable one', () => {
  assert.equal(planSync([], 'ABC-1', 'h').action, 'create')
  assert.equal(planSync(null, 'ABC-1', 'h').action, 'refuse')
})
