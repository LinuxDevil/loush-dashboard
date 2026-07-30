import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { git, gitOut, isLockError, lockInfo, normaliseRemote, checkOrigin, READ_COMMANDS } from '../../lib/git-safe.mjs'

const repo = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'gitsafe-'))
  const run = (...a) => spawnSync('git', ['-C', d, ...a], { encoding: 'utf8' })
  run('init', '-q', '-b', 'main')
  run('config', 'user.email', 't@example.com')
  run('config', 'user.name', 'T')
  fs.writeFileSync(path.join(d, 'a.txt'), 'hello\n')
  run('add', 'a.txt')
  run('commit', '-qm', 'first')
  return d
}
const drop = d => fs.rmSync(d, { recursive: true, force: true })

test('a read command is run with --no-optional-locks, before the subcommand', () => {
  const d = repo()
  try {
    const r = git(d, ['status', '--porcelain'])
    assert.equal(r.ok, true, r.stderr)
    assert.equal(r.readOnly, true)
    const i = r.command.indexOf('--no-optional-locks')
    assert.ok(i > 0, 'the flag must be present')
    assert.ok(i < r.command.indexOf('status'), 'it is a git-level option, so it must precede the subcommand')
  } finally { drop(d) }
})

test('a write command does NOT get the flag — git rejects it on some subcommands', () => {
  const d = repo()
  try {
    fs.writeFileSync(path.join(d, 'b.txt'), 'x\n')
    const r = git(d, ['add', 'b.txt'])
    assert.equal(r.ok, true, r.stderr)
    assert.equal(r.readOnly, false)
    assert.ok(!r.command.includes('--no-optional-locks'))
  } finally { drop(d) }
})

test('an unrecognised subcommand is treated as a write, so new commands are guarded by default', () => {
  const d = repo()
  try {
    assert.equal(git(d, ['some-future-command']).readOnly, false)
  } finally { drop(d) }
})

test('the classification can be overridden both ways', () => {
  const d = repo()
  try {
    assert.equal(git(d, ['status'], { write: true }).readOnly, false)
    assert.equal(git(d, ['gc', '--dry-run'], { write: false }).readOnly, true)
  } finally { drop(d) }
})

test('every listed read command really is read-only in git', () => {
  // A write accidentally added to READ_COMMANDS would get --no-optional-locks and, worse, be
  // treated as safe to run concurrently.
  for (const w of ['add', 'commit', 'push', 'pull', 'fetch', 'rebase', 'merge', 'checkout', 'reset', 'clean', 'stash', 'worktree']) {
    assert.ok(!READ_COMMANDS.has(w), `${w} must not be classified read-only`)
  }
})

test('real git output comes back on the happy path', () => {
  const d = repo()
  try {
    assert.equal(gitOut(d, ['rev-list', '--count', 'HEAD']), '1')
    assert.match(gitOut(d, ['log', '--oneline']), /first/)
  } finally { drop(d) }
})

test('a failed read returns null rather than an empty string that reads as a real answer', () => {
  const d = repo()
  try {
    assert.equal(gitOut(d, ['rev-parse', 'no-such-ref']), null)
  } finally { drop(d) }
})

test('a git failure is data, not an exception', () => {
  const d = repo()
  try {
    const r = git(d, ['rev-parse', 'no-such-ref'])
    assert.equal(r.ok, false)
    assert.equal(r.locked, false)
    assert.ok(r.reason, 'a failure must carry a reason a person can read')
  } finally { drop(d) }
})

test('running against a directory that is not a repository fails cleanly', () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'notrepo-'))
  try {
    const r = git(d, ['status'])
    assert.equal(r.ok, false)
    assert.equal(r.locked, false)
    assert.ok(r.reason)
  } finally { drop(d) }
})

// ---- lock handling ----

test('git lock messages are recognised; ordinary errors are not', () => {
  assert.ok(isLockError("fatal: Unable to create '/r/.git/index.lock': File exists."))
  assert.ok(isLockError('Another git process seems to be running in this repository'))
  assert.ok(!isLockError('fatal: not a git repository'))
  assert.ok(!isLockError('error: pathspec did not match'))
  assert.ok(!isLockError(''))
  assert.ok(!isLockError(null))
})

test('a real lock collision is reported as contention, not corruption', () => {
  const d = repo()
  try {
    // Hold the index lock the way a concurrent writer would.
    fs.writeFileSync(path.join(d, '.git', 'index.lock'), '')
    fs.writeFileSync(path.join(d, 'c.txt'), 'x\n')
    const r = git(d, ['add', 'c.txt'])
    assert.equal(r.ok, false)
    assert.equal(r.locked, true, `expected a lock error, got: ${r.stderr}`)
    assert.match(r.reason, /contention, not corruption/)
    assert.match(r.reason, /nothing was changed/)
    assert.ok(r.lock, 'the lock is described')
    assert.ok(r.lock.ageMs >= 0)
  } finally { drop(d) }
})

test('the lock file is reported but never removed', () => {
  const d = repo()
  const lock = path.join(d, '.git', 'index.lock')
  try {
    fs.writeFileSync(lock, '')
    fs.writeFileSync(path.join(d, 'c.txt'), 'x\n')
    git(d, ['add', 'c.txt'])
    assert.ok(fs.existsSync(lock), 'deleting a live lock is how two writers corrupt an index')
  } finally { drop(d) }
})

test('a read still works while the index is locked — that is the whole point', () => {
  const d = repo()
  try {
    fs.writeFileSync(path.join(d, '.git', 'index.lock'), '')
    const r = git(d, ['log', '--oneline'])
    assert.equal(r.ok, true, r.stderr)
  } finally { drop(d) }
})

test('lockInfo reports nothing when there is no lock', () => {
  const d = repo()
  try {
    assert.equal(lockInfo(d), null)
    fs.writeFileSync(path.join(d, '.git', 'index.lock'), '')
    assert.ok(lockInfo(d).ageMs >= 0)
  } finally { drop(d) }
})

// ---- remote identity ----

test('the same remote written four ways normalises to one value', () => {
  const forms = [
    'git@github.com:owner/repo.git',
    'https://github.com/owner/repo',
    'https://github.com/owner/repo.git',
    'https://github.com/owner/repo/',
  ]
  const all = forms.map(normaliseRemote)
  assert.equal(new Set(all).size, 1, `a false mismatch is how a safety check gets switched off: ${JSON.stringify(all)}`)
  assert.equal(all[0], 'github.com/owner/repo')
})

test('different repositories do not normalise together', () => {
  assert.notEqual(normaliseRemote('https://github.com/owner/repo'), normaliseRemote('https://github.com/owner/other'))
  assert.notEqual(normaliseRemote('https://github.com/owner/repo'), normaliseRemote('https://gitlab.com/owner/repo'))
})

test('host case is ignored but path case is not', () => {
  assert.equal(normaliseRemote('https://GitHub.com/owner/repo'), 'github.com/owner/repo')
  assert.notEqual(normaliseRemote('https://github.com/Owner/Repo'), 'github.com/owner/repo')
})

test('an empty remote normalises to null, not to a value that could match', () => {
  for (const v of ['', null, undefined, '   ']) assert.equal(normaliseRemote(v), null, JSON.stringify(v))
})

test('a matching origin passes', () => {
  const d = repo()
  try {
    spawnSync('git', ['-C', d, 'remote', 'add', 'origin', 'git@github.com:owner/repo.git'])
    assert.equal(checkOrigin(d, 'https://github.com/owner/repo').ok, true)
  } finally { drop(d) }
})

test('a mismatched origin is refused and both sides are named', () => {
  const d = repo()
  try {
    spawnSync('git', ['-C', d, 'remote', 'add', 'origin', 'https://github.com/someone/else'])
    const r = checkOrigin(d, 'https://github.com/owner/repo')
    assert.equal(r.ok, false)
    assert.equal(r.reason, 'remote-mismatch')
    assert.match(r.detail, /someone\/else/)
    assert.match(r.detail, /refusing to write/)
  } finally { drop(d) }
})

test('no origin at all is a refusal — unknown is not a match', () => {
  const d = repo()
  try {
    const r = checkOrigin(d, 'https://github.com/owner/repo')
    assert.equal(r.ok, false)
    assert.equal(r.reason, 'no-remote')
  } finally { drop(d) }
})

test('no configured expectation is a refusal, not a pass', () => {
  const d = repo()
  try {
    spawnSync('git', ['-C', d, 'remote', 'add', 'origin', 'https://github.com/owner/repo'])
    const r = checkOrigin(d, '')
    assert.equal(r.ok, false)
    assert.equal(r.reason, 'no-expectation')
    assert.match(r.detail, /never stated/)
  } finally { drop(d) }
})
