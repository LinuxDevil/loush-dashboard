// Tests for lib/open-folder.mjs — the hardened "reveal in file manager" endpoint.
//
// The launcher is injected (`execFileImpl`) so every platform branch is exercised on Linux CI without
// actually opening a window, and so the test can assert on the exact ARGV that would have been
// executed — which is the property the whole module rests on.

import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { openFolder, resolveOpenTarget, PLATFORM_COMMANDS, SUPPORTED_PLATFORMS, OPEN_LIMITS } from '../../lib/open-folder.mjs'

const tmps = []
function sandbox() {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'openfolder-')))
  tmps.push(base)
  const root = path.join(base, 'projects')
  fs.mkdirSync(path.join(root, 'alpha', 'src'), { recursive: true })
  fs.mkdirSync(path.join(base, 'outside', 'secrets'), { recursive: true })
  fs.writeFileSync(path.join(root, 'alpha', 'file.txt'), 'x')
  return { base, root, alpha: path.join(root, 'alpha'), outside: path.join(base, 'outside') }
}
after(() => { for (const d of tmps) { try { fs.rmSync(d, { recursive: true, force: true }) } catch { /* best effort */ } } })

/** Records what would have been launched and reports success. */
function fakeExec(record) {
  return (command, args, opts, cb) => {
    record.push({ command, args, opts })
    setImmediate(() => cb(null, '', ''))
    return { on() {} }
  }
}
/** Fails the way a given errno would. */
function failingExec(error) {
  return (command, args, opts, cb) => { setImmediate(() => cb(error, '', error.stderr || '')) ; return { on() {} } }
}

// ---------------------------------------------------------------------------------------------
// the happy path, and the argv guarantee

test('a folder inside a configured root is opened, with the path as ONE argv element', async () => {
  const s = sandbox()
  const calls = []
  const r = await openFolder(s.alpha, { roots: [s.root], platform: 'linux', execFileImpl: fakeExec(calls) })
  assert.equal(r.ok, true, r.reason)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].command, 'xdg-open')
  assert.deepEqual(calls[0].args, [s.alpha], 'exactly one argv element — no string was built')
  assert.equal(calls[0].opts.shell, false, 'shell:false is the property everything here depends on')
  assert.equal(r.resolved, s.alpha)
  assert.equal(r.root, s.root)
})

test('a shell-metacharacter directory name is passed through inert', async () => {
  const s = sandbox()
  const evil = path.join(s.root, 'a; rm -rf $HOME && echo `id`')
  fs.mkdirSync(evil)
  const calls = []
  const r = await openFolder(evil, { roots: [s.root], platform: 'linux', execFileImpl: fakeExec(calls) })
  assert.equal(r.ok, true, r.reason)
  assert.equal(calls[0].args.length, 1, 'still ONE argument, however many spaces and semicolons it has')
  assert.equal(calls[0].args[0], evil)
})

test('a nested subdirectory of a root is allowed', async () => {
  const s = sandbox()
  const r = await openFolder(path.join(s.alpha, 'src'), { roots: [s.root], platform: 'linux', execFileImpl: fakeExec([]) })
  assert.equal(r.ok, true, r.reason)
  assert.equal(r.rel, path.join('alpha', 'src'))
})

test('the root itself is allowed', async () => {
  const s = sandbox()
  const r = await openFolder(s.root, { roots: [s.root], platform: 'linux', execFileImpl: fakeExec([]) })
  assert.equal(r.ok, true, r.reason)
  assert.equal(r.rel, '.')
})

// ---------------------------------------------------------------------------------------------
// every refusal path

test('REFUSAL: a path outside every root, reached by traversal', async () => {
  const s = sandbox()
  const calls = []
  const traversal = path.join(s.root, '..', 'outside', 'secrets')
  const r = await openFolder(traversal, { roots: [s.root], platform: 'linux', execFileImpl: fakeExec(calls) })
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'outside-allowed-roots')
  assert.equal(r.check, 'containment')
  assert.equal(calls.length, 0, 'nothing was launched')
})

test('REFUSAL: an absolute path outside every root', async () => {
  const s = sandbox()
  const r = await openFolder('/etc', { roots: [s.root], platform: 'linux', execFileImpl: fakeExec([]) })
  assert.equal(r.reason, 'outside-allowed-roots')
})

test('REFUSAL: a SYMLINK inside a root that points out of it', async () => {
  const s = sandbox()
  const link = path.join(s.root, 'escape')
  fs.symlinkSync(path.join(s.outside, 'secrets'), link)
  const calls = []
  const r = await openFolder(link, { roots: [s.root], platform: 'linux', execFileImpl: fakeExec(calls) })
  assert.equal(r.ok, false, 'this is why containment runs on the REALPATH')
  assert.equal(r.reason, 'outside-allowed-roots')
  assert.equal(r.viaSymlink, true, 'and the caller is told a symlink was involved')
  assert.equal(calls.length, 0)
})

test('a symlink inside a root that points WITHIN the root is allowed, and resolves', async () => {
  const s = sandbox()
  const link = path.join(s.root, 'shortcut')
  fs.symlinkSync(path.join(s.alpha, 'src'), link)
  const r = await openFolder(link, { roots: [s.root], platform: 'linux', execFileImpl: fakeExec([]) })
  assert.equal(r.ok, true, r.reason)
  assert.equal(r.resolved, path.join(s.alpha, 'src'), 'the RESOLVED path is what gets opened')
  assert.equal(r.viaSymlink, true)
})

test('REFUSAL: a sibling directory whose name merely shares a prefix with a root', async () => {
  const s = sandbox()
  const sibling = path.join(s.base, 'projects-private')
  fs.mkdirSync(sibling)
  const r = await openFolder(sibling, { roots: [s.root], platform: 'linux', execFileImpl: fakeExec([]) })
  assert.equal(r.reason, 'outside-allowed-roots', 'startsWith() would have let this through')
})

test('REFUSAL: no roots configured — fail CLOSED, never "everything allowed"', async () => {
  const s = sandbox()
  const calls = []
  const r = await openFolder(s.alpha, { roots: [], platform: 'linux', execFileImpl: fakeExec(calls) })
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'no-roots-configured')
  assert.equal(r.check, 'roots-empty')
  assert.equal(calls.length, 0)
})

test('REFUSAL: roots that is not an array', async () => {
  const s = sandbox()
  assert.equal((await openFolder(s.alpha, { roots: s.root, platform: 'linux' })).reason, 'roots-must-be-array')
  assert.equal((await openFolder(s.alpha, { platform: 'linux' })).reason, 'roots-must-be-array')
  assert.equal((await openFolder(s.alpha, { roots: null, platform: 'linux' })).reason, 'roots-must-be-array')
})

test('REFUSAL: every configured root is unusable — and each one is named', async () => {
  const s = sandbox()
  const r = await openFolder(s.alpha, {
    roots: [path.join(s.base, 'nope'), path.join(s.root, 'alpha', 'file.txt'), ''],
    platform: 'linux', execFileImpl: fakeExec([]),
  })
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'no-usable-roots')
  const reasons = r.rootsSkipped.map(x => x.reason).sort()
  assert.deepEqual(reasons, ['root-invalid', 'root-not-a-directory', 'root-not-found'])
})

test('one bad root among good ones is reported but does not block the good one', async () => {
  const s = sandbox()
  const r = await openFolder(s.alpha, { roots: [path.join(s.base, 'gone'), s.root], platform: 'linux', execFileImpl: fakeExec([]) })
  assert.equal(r.ok, true, r.reason)
  assert.equal(r.rootsSkipped.length, 1, 'a misconfigured root is never silently dropped')
  assert.equal(r.rootsSkipped[0].reason, 'root-not-found')
})

test('REFUSAL: target missing, empty, wrong type, over-long, or NUL-poisoned', async () => {
  const s = sandbox()
  const cases = [
    [undefined, 'target-required'], [null, 'target-required'], ['', 'target-required'],
    ['   ', 'target-required'], [42, 'target-required'], [{}, 'target-required'],
    [`${s.alpha}\0/../../etc`, 'target-contains-nul'],
    ['/x'.repeat(OPEN_LIMITS.maxPathLength), 'target-too-long'],
  ]
  for (const [target, reason] of cases) {
    const r = await openFolder(target, { roots: [s.root], platform: 'linux', execFileImpl: fakeExec([]) })
    assert.equal(r.ok, false)
    assert.equal(r.reason, reason, `for ${JSON.stringify(String(target)).slice(0, 40)}`)
    assert.ok(r.check, 'the failing check is always named')
  }
})

test('REFUSAL: target does not exist', async () => {
  const s = sandbox()
  const r = await openFolder(path.join(s.root, 'no-such-folder'), { roots: [s.root], platform: 'linux', execFileImpl: fakeExec([]) })
  assert.equal(r.reason, 'target-not-found')
  assert.equal(r.check, 'target-exists')
})

test('REFUSAL: target is a FILE, not a directory', async () => {
  const s = sandbox()
  const r = await openFolder(path.join(s.alpha, 'file.txt'), { roots: [s.root], platform: 'linux', execFileImpl: fakeExec([]) })
  assert.equal(r.reason, 'target-not-a-directory')
  assert.equal(r.check, 'target-kind')
})

test('REFUSAL: target is a broken symlink', async () => {
  const s = sandbox()
  const link = path.join(s.root, 'dangling')
  fs.symlinkSync(path.join(s.root, 'gone-forever'), link)
  const r = await openFolder(link, { roots: [s.root], platform: 'linux', execFileImpl: fakeExec([]) })
  assert.equal(r.reason, 'target-broken-symlink')
  assert.equal(r.check, 'target-realpath')
})

test('REFUSAL: too many roots, with the cap named', async () => {
  const s = sandbox()
  const r = await openFolder(s.alpha, { roots: Array(OPEN_LIMITS.maxRoots + 1).fill(s.root), platform: 'linux' })
  assert.equal(r.reason, 'too-many-roots')
  assert.equal(r.max, OPEN_LIMITS.maxRoots)
  assert.equal(r.given, OPEN_LIMITS.maxRoots + 1)
})

// ---------------------------------------------------------------------------------------------
// platform table

test('the platform table covers darwin/win32/linux and each launches the documented argv', async () => {
  const s = sandbox()
  assert.deepEqual([...SUPPORTED_PLATFORMS].sort(), ['darwin', 'linux', 'win32'])

  const expected = {
    darwin: ['open', ['-R', s.alpha]],
    win32: ['explorer.exe', [s.alpha]],
    linux: ['xdg-open', [s.alpha]],
  }
  for (const [platform, [command, args]] of Object.entries(expected)) {
    const calls = []
    const r = await openFolder(s.alpha, { roots: [s.root], platform, execFileImpl: fakeExec(calls) })
    assert.equal(r.ok, true, `${platform}: ${r.reason}`)
    assert.equal(calls[0].command, command)
    assert.deepEqual(calls[0].args, args)
    assert.equal(PLATFORM_COMMANDS[platform].command, command)
  }
})

test('REFUSAL: an unsupported platform is named, never guessed at', async () => {
  const s = sandbox()
  const calls = []
  for (const platform of ['aix', 'sunos', 'freebsd', 'haiku']) {
    const r = await openFolder(s.alpha, { roots: [s.root], platform, execFileImpl: fakeExec(calls) })
    assert.equal(r.ok, false)
    assert.equal(r.reason, 'unsupported-platform')
    assert.equal(r.platform, platform)
    assert.deepEqual([...r.supported].sort(), ['darwin', 'linux', 'win32'])
  }
  assert.equal(calls.length, 0, 'no fallback binary was tried')
})

test('the platform is checked before the path, so the user learns the feature is unavailable', async () => {
  const r = await openFolder('/definitely/not/here', { roots: ['/tmp'], platform: 'plan9' })
  assert.equal(r.reason, 'unsupported-platform')
})

// ---------------------------------------------------------------------------------------------
// launcher failures

test('explorer.exe exiting 1 is SUCCESS on win32 — it always does', async () => {
  const s = sandbox()
  const e = Object.assign(new Error('Command failed'), { code: 1 })
  const r = await openFolder(s.alpha, { roots: [s.root], platform: 'win32', execFileImpl: failingExec(e) })
  assert.equal(r.ok, true, 'a non-zero exit from explorer.exe must not be reported as a failure')
})

test('the same exit code IS a failure on linux', async () => {
  const s = sandbox()
  const e = Object.assign(new Error('Command failed'), { code: 1, stderr: 'no application' })
  const r = await openFolder(s.alpha, { roots: [s.root], platform: 'linux', execFileImpl: failingExec(e) })
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'launcher-failed')
  assert.equal(r.exitCode, 1)
  assert.match(r.stderr, /no application/)
})

test('REFUSAL: the launcher binary is not installed', async () => {
  const s = sandbox()
  const e = Object.assign(new Error('spawn xdg-open ENOENT'), { code: 'ENOENT' })
  const r = await openFolder(s.alpha, { roots: [s.root], platform: 'linux', execFileImpl: failingExec(e) })
  assert.equal(r.reason, 'launcher-not-installed')
  assert.equal(r.command, 'xdg-open')
  assert.ok(r.note, 'and the caller is told what to install')
})

test('REFUSAL: the launcher timed out, with the timeout reported', async () => {
  const s = sandbox()
  const e = Object.assign(new Error('timeout'), { code: null, killed: true })
  const r = await openFolder(s.alpha, { roots: [s.root], platform: 'linux', timeoutMs: 250, execFileImpl: failingExec(e) })
  assert.equal(r.reason, 'launcher-timeout')
  assert.equal(r.timeoutMs, 250, 'the bound in force is reported')
})

test('a launcher that THROWS synchronously is caught, not propagated', async () => {
  const s = sandbox()
  const boom = () => { throw new Error('kaboom') }
  let r
  await assert.doesNotReject(async () => { r = await openFolder(s.alpha, { roots: [s.root], platform: 'linux', execFileImpl: boom }) })
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'launcher-spawn-threw')
})

// ---------------------------------------------------------------------------------------------
// the pure check is usable on its own

test('resolveOpenTarget validates without launching anything, and never throws', () => {
  const s = sandbox()
  assert.equal(resolveOpenTarget(s.alpha, [s.root]).ok, true)
  for (const [t, roots] of [[null, [s.root]], ['/etc', [s.root]], [s.alpha, []], [s.alpha, 'x'], [{}, [s.root]]]) {
    let r
    assert.doesNotThrow(() => { r = resolveOpenTarget(t, roots) })
    assert.equal(r.ok, false)
    assert.ok(r.reason && r.check)
    assert.equal(r.refused, true)
    assert.ok(r.limits, 'the limits are reported even on refusal')
  }
})
