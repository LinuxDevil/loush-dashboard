import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import mountDocs, { resolveDocPath, isInside, unfence, listDocs, MAX_FILE_BYTES } from '../../server/docs.mjs'

// Layout — the sibling directory is the point. `/…/docs-evil` shares a string prefix with the root
// `/…/docs`, so any containment check written with `startsWith` admits it.
const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'docs-test-')))
const ROOT = path.join(TMP, 'docs')
const EVIL = path.join(TMP, 'docs-evil')
const OUTSIDE = path.join(TMP, 'outside')

fs.mkdirSync(path.join(ROOT, 'sub'), { recursive: true })
fs.mkdirSync(EVIL, { recursive: true })
fs.mkdirSync(OUTSIDE, { recursive: true })
fs.writeFileSync(path.join(ROOT, 'note.md'), '# note\n\nhello\n')
fs.writeFileSync(path.join(ROOT, 'sub', 'data.csv'), 'a,b\n1,2\n')
fs.writeFileSync(path.join(EVIL, 'secret.md'), 'sibling-prefix secret\n')
fs.writeFileSync(path.join(OUTSIDE, 'secret.md'), 'outside secret\n')
// Symlinks: one file link and one directory link, both pointing out of the root. Skipped on
// platforms that refuse to create them (Windows without developer mode) rather than failing.
let symlinks = true
try {
  fs.symlinkSync(path.join(OUTSIDE, 'secret.md'), path.join(ROOT, 'link.md'))
  fs.symlinkSync(EVIL, path.join(ROOT, 'evildir'), 'dir')
} catch { symlinks = false }

// ---------------------------------------------------------------- the path guard (the priority)

const reason = p => { const r = resolveDocPath(ROOT, p); return r.ok ? null : r.reason }

test('rejects every `..` traversal, however it is spelled', () => {
  for (const p of ['../secret.md', '../docs-evil/secret.md', 'sub/../../secret.md',
    './../secret.md', 'sub/../../../etc/hosts.md', '..\\secret.md', 'a/..//../secret.md']) {
    assert.equal(reason(p), 'parent-traversal', `should reject ${p}`)
  }
})

test('rejects absolute paths, POSIX and Windows', () => {
  for (const p of ['/etc/passwd.md', path.join(OUTSIDE, 'secret.md'), 'C:\\Windows\\x.md',
    '\\\\server\\share\\x.md', '/note.md']) {
    assert.equal(reason(p), 'absolute-path', `should reject ${p}`)
  }
})

test('the /root-evil prefix case: a sibling sharing the root\'s string prefix is outside it', () => {
  // The check that a `startsWith` implementation gets wrong, stated directly on the primitive…
  assert.equal(isInside(ROOT, path.join(EVIL, 'secret.md')), false)
  assert.ok(path.join(EVIL, 'secret.md').startsWith(ROOT), 'the string prefix really does match — that is why prefix checks fail')
  // …and through the resolver, which never accepts the sibling by any spelling.
  assert.equal(reason('../docs-evil/secret.md'), 'parent-traversal')
  assert.equal(reason(EVIL + '/secret.md'), 'absolute-path')
  assert.equal(isInside(ROOT, path.join(ROOT, 'note.md')), true)
  assert.equal(isInside(ROOT, ROOT), false, 'the root is not a file inside itself')
})

test('rejects a symlink that leaves the root, file or directory', { skip: !symlinks && 'symlinks unavailable' }, () => {
  assert.equal(reason('link.md'), 'symlink-escapes-root')
  assert.equal(reason('evildir/secret.md'), 'symlink-escapes-root')
})

test('rejects control characters, over-long paths and unsupported types', () => {
  assert.equal(reason('note\u0000.png.md'), 'bad-characters')
  assert.equal(reason('a'.repeat(1100) + '.md'), 'path-too-long')
  assert.equal(reason('note.exe'), 'unsupported-type')
  assert.equal(reason('note'), 'unsupported-type')
  for (const p of ['', '   ', null, undefined, 42, '.', './']) assert.equal(reason(p), 'path-required', `should reject ${p}`)
})

test('accepts an ordinary relative path and normalises it', () => {
  const r = resolveDocPath(ROOT, './sub/data.csv')
  assert.equal(r.ok, true)
  assert.equal(r.rel, 'sub/data.csv')
  assert.equal(r.abs, path.join(ROOT, 'sub', 'data.csv'))
  assert.equal(r.ext, 'csv')
})

test('listDocs walks the root and does not follow symlinks out of it', () => {
  const files = listDocs(ROOT).map(f => f.path).sort()
  assert.deepEqual(files, ['note.md', 'sub/data.csv'])
})

// ---------------------------------------------------------------- routes

const agentCalls = []
const fakeAgent = async opts => { agentCalls.push(opts); return { result: 'REWRITTEN\n', cost: 0.01 } }

function harness(runAgent = fakeAgent) {
  const routes = new Map()
  const app = {}
  for (const m of ['get', 'post', 'put', 'patch', 'delete']) app[m] = (p, h) => routes.set(m + ' ' + p, h)
  mountDocs(app, { root: ROOT, runAgent })
  return async (method, urlPath, { query = {}, body = {} } = {}) => {
    const h = routes.get(method + ' ' + urlPath)
    assert.ok(h, `no handler for ${method} ${urlPath}`)
    let status = 200, out
    const res = { status(c) { status = c; return this }, json(b) { out = b; return this } }
    await h({ query, params: {}, body }, res)
    return { status, body: out }
  }
}
const call = harness()

test('GET /api/docs reports the root and its files', async () => {
  const r = await call('get', '/api/docs')
  assert.equal(r.status, 200)
  assert.equal(r.body.root, ROOT)
  assert.deepEqual(r.body.files.map(f => f.path).sort(), ['note.md', 'sub/data.csv'])
  assert.equal(r.body.limits.fileBytes, MAX_FILE_BYTES)
})

test('GET /api/docs/file reads inside the root and refuses to escape it', async () => {
  const ok = await call('get', '/api/docs/file', { query: { path: 'note.md' } })
  assert.equal(ok.status, 200)
  assert.equal(ok.body.text, '# note\n\nhello\n')

  for (const p of ['../docs-evil/secret.md', '/etc/passwd.md', 'sub/../../outside/secret.md']) {
    const bad = await call('get', '/api/docs/file', { query: { path: p } })
    assert.equal(bad.status, 400, `should refuse ${p}`)
    assert.ok(bad.body.error)
  }
  assert.equal((await call('get', '/api/docs/file', { query: { path: 'nope.md' } })).status, 404)
})

test('PUT /api/docs/file writes inside the root and nowhere else', async () => {
  const w = await call('put', '/api/docs/file', { query: { path: 'sub/new.md' }, body: { text: 'fresh\n' } })
  assert.equal(w.status, 200)
  assert.equal(w.body.ok, true)
  assert.equal(fs.readFileSync(path.join(ROOT, 'sub', 'new.md'), 'utf8'), 'fresh\n')

  const before = fs.readFileSync(path.join(OUTSIDE, 'secret.md'), 'utf8')
  for (const p of ['../outside/secret.md', path.join(OUTSIDE, 'secret.md'), ...(symlinks ? ['link.md'] : [])]) {
    const bad = await call('put', '/api/docs/file', { query: { path: p }, body: { text: 'PWNED' } })
    assert.equal(bad.status, 400, `should refuse ${p}`)
  }
  assert.equal(fs.readFileSync(path.join(OUTSIDE, 'secret.md'), 'utf8'), before, 'nothing outside the root was written')
  assert.equal((await call('put', '/api/docs/file', { query: { path: 'note.md' }, body: {} })).status, 400)
  const big = await call('put', '/api/docs/file', { query: { path: 'big.md' }, body: { text: 'x'.repeat(MAX_FILE_BYTES + 1) } })
  assert.equal(big.status, 413)
  assert.equal(fs.existsSync(path.join(ROOT, 'big.md')), false)
})

// The endpoint not writing is only half the promise. lib/agent.mjs spawns the CLI with
// --dangerously-skip-permissions, so a model handed Write could edit the file itself and the
// accept/reject diff would be reviewing a change that had already landed. The tools have to be
// refused at the spawn, not merely discouraged in the prompt.
test('ai-edit refuses the agent every tool that could write', async () => {
  agentCalls.length = 0
  const call = harness()
  const r = await call('post', '/api/docs/ai-edit', { body: { path: 'note.md', instruction: 'tighten it' } })
  assert.equal(r.status, 200)
  assert.equal(agentCalls.length, 1)
  const refused = agentCalls[0].disallowedTools || []
  for (const tool of ['Write', 'Edit', 'MultiEdit', 'NotebookEdit', 'Bash', 'Task'])
    assert.ok(refused.includes(tool), `${tool} must be refused to the ai-edit agent`)
})

// The rule this endpoint exists to obey. If it ever writes, the accept/reject diff is theatre.
test('POST /api/docs/ai-edit proposes text and leaves the file on disk untouched', async () => {
  const file = path.join(ROOT, 'note.md')
  const before = fs.readFileSync(file, 'utf8')
  const beforeStat = fs.statSync(file)

  const whole = await call('post', '/api/docs/ai-edit', { body: { path: 'note.md', instruction: 'tighten it' } })
  assert.equal(whole.status, 200)
  assert.equal(whole.body.text, 'REWRITTEN\n')
  assert.equal(whole.body.wrote, false)
  assert.equal(fs.readFileSync(file, 'utf8'), before)
  assert.equal(fs.statSync(file).mtimeMs, beforeStat.mtimeMs)

  const sel = await call('post', '/api/docs/ai-edit', { body: { path: 'note.md', selection: 'hello', instruction: 'louder' } })
  assert.equal(sel.status, 200)
  assert.equal(sel.body.text, '# note\n\nREWRITTEN\n\n', 'selection is spliced into the whole-file proposal')
  assert.equal(sel.body.selection, 'hello')
  assert.equal(fs.readFileSync(file, 'utf8'), before, 'still untouched after a selection edit')
  assert.ok(agentCalls.at(-1).prompt.includes('louder'))
})

test('POST /api/docs/ai-edit refuses to run at all on a path outside the root', async () => {
  let ran = false
  const call2 = harness(async () => { ran = true; return { result: 'x' } })
  for (const p of ['../outside/secret.md', path.join(OUTSIDE, 'secret.md'), ...(symlinks ? ['link.md'] : [])]) {
    const r = await call2('post', '/api/docs/ai-edit', { body: { path: p, instruction: 'summarise' } })
    assert.equal(r.status, 400, `should refuse ${p}`)
  }
  assert.equal(ran, false, 'the guard runs before the agent, so nothing outside the root is even read')
})

test('POST /api/docs/ai-edit validates the instruction and the selection', async () => {
  assert.equal((await call('post', '/api/docs/ai-edit', { body: { path: 'note.md' } })).status, 400)
  assert.equal((await call('post', '/api/docs/ai-edit', { body: { path: 'note.md', instruction: 'x'.repeat(3000) } })).status, 400)
  const stale = await call('post', '/api/docs/ai-edit', { body: { path: 'note.md', selection: 'not in the file', instruction: 'fix' } })
  assert.equal(stale.status, 409)
  assert.equal(stale.body.error, 'selection-not-in-file')
})

test('an agent error or an empty answer is reported, not written', async () => {
  const failing = harness(async () => ({ error: 'timeout after 2min' }))
  assert.equal((await failing('post', '/api/docs/ai-edit', { body: { path: 'note.md', instruction: 'x' } })).status, 502)
  const empty = harness(async () => ({ result: '   ' }))
  const r = await empty('post', '/api/docs/ai-edit', { body: { path: 'note.md', instruction: 'x' } })
  assert.equal(r.status, 200)
  assert.equal(r.body.text, '   ', 'whitespace is a real answer for a file the user asked to blank')
})

test('unfence strips one fence and nothing else', () => {
  assert.equal(unfence('```md\nhi\n```'), 'hi')
  assert.equal(unfence('```\nhi\n```'), 'hi')
  assert.equal(unfence('hi\n\n```js\ncode\n```\ntail'), 'hi\n\n```js\ncode\n```\ntail')
  assert.equal(unfence(null), '')
})
