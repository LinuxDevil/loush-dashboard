import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  parseWorktreeList,
  parseGitFile,
  detectWorktree,
  listWorktrees,
  attributeSession,
  normalizeForCompare,
  MAX_ASCEND,
} from '../../lib/worktree.mjs'

// ------------------------------------------------------------------------------------------
// Fixture: verbatim `git worktree list --porcelain` output from git 2.43.0, captured from a
// scratch repo built with `git init`, `git worktree add -b feature/x`, `git worktree add
// --detach`, `git worktree lock --reason testing`, and then deleting the detached directory to
// make it prunable. Not invented — the exact bytes git printed, with the paths kept as-is.
// ------------------------------------------------------------------------------------------
const REAL_PORCELAIN = `worktree /tmp/wt-thUVGv/main
HEAD cba4d719f9560267c8506f901a280943678b8bdb
branch refs/heads/master

worktree /tmp/wt-thUVGv/detached
HEAD cba4d719f9560267c8506f901a280943678b8bdb
detached
prunable gitdir file points to non-existent location

worktree /tmp/wt-thUVGv/feat-x
HEAD cba4d719f9560267c8506f901a280943678b8bdb
branch refs/heads/feature/x

worktree /tmp/wt-thUVGv/locked
HEAD cba4d719f9560267c8506f901a280943678b8bdb
branch refs/heads/locked-branch
locked testing

`

// Real output from `git worktree list --porcelain` inside a `git init --bare` repository.
// A bare entry has NO HEAD line at all.
const REAL_BARE_PORCELAIN = `worktree /tmp/wt-thUVGv/barerepo.git
bare

`

const gitAvailable = (() => {
  try { return spawnSync('git', ['--version'], { encoding: 'utf8' }).status === 0 } catch { return false }
})()

// ------------------------------------------------------------------------------------------
// parseWorktreeList
// ------------------------------------------------------------------------------------------

test('real porcelain output yields one entry per worktree in git order', () => {
  const wts = parseWorktreeList(REAL_PORCELAIN)
  assert.equal(wts.length, 4)
  assert.deepEqual(wts.map(w => w.path), [
    '/tmp/wt-thUVGv/main',
    '/tmp/wt-thUVGv/detached',
    '/tmp/wt-thUVGv/feat-x',
    '/tmp/wt-thUVGv/locked',
  ])
  assert.equal(wts[0].head, 'cba4d719f9560267c8506f901a280943678b8bdb')
})

test('a branch is reported as the full ref and as a short name that keeps its slashes', () => {
  // The regression this guards: stripping to the last path segment turns `refs/heads/feature/x`
  // into `x`, so every `feature/…` and `release/…` branch collapses onto a wrong short name and
  // two different worktrees look like the same branch in the UI.
  const [, , featx] = parseWorktreeList(REAL_PORCELAIN)
  assert.equal(featx.branch, 'refs/heads/feature/x')
  assert.equal(featx.branchName, 'feature/x')
})

test('a detached worktree is flagged detached with no branch rather than a blank branch name', () => {
  const detached = parseWorktreeList(REAL_PORCELAIN)[1]
  assert.equal(detached.detached, true)
  assert.equal(detached.branch, null)
  assert.equal(detached.branchName, null)
})

test('prunable carries its reason instead of being a bare boolean', () => {
  // The regression this guards: reporting "prunable: true" with no reason gives a user no way
  // to tell a deleted checkout from an administratively marked one, and prune is destructive.
  const detached = parseWorktreeList(REAL_PORCELAIN)[1]
  assert.equal(detached.prunable, true)
  assert.equal(detached.prunableReason, 'gitdir file points to non-existent location')
  assert.equal(parseWorktreeList(REAL_PORCELAIN)[0].prunable, false)
})

test('a locked worktree keeps its lock reason', () => {
  const locked = parseWorktreeList(REAL_PORCELAIN)[3]
  assert.equal(locked.locked, true)
  assert.equal(locked.lockReason, 'testing')
})

test('locking with no reason still reads as locked', () => {
  // Real output of `git worktree lock <path>` with no --reason: a bare `locked` line. Keying
  // lock state off the presence of a reason string reports these worktrees as unlocked, and a
  // caller then offers a remove action git will refuse.
  const wts = parseWorktreeList('worktree /r/a\nHEAD abc\nbranch refs/heads/b\nlocked\n\n')
  assert.equal(wts[0].locked, true)
  assert.equal(wts[0].lockReason, null)
})

test('a bare repository entry parses despite having no HEAD line', () => {
  const wts = parseWorktreeList(REAL_BARE_PORCELAIN)
  assert.equal(wts.length, 1)
  assert.equal(wts[0].bare, true)
  assert.equal(wts[0].head, null)
  assert.equal(wts[0].branch, null)
})

test('CRLF porcelain from git-for-windows parses identically to LF', () => {
  // The regression this guards: an unstripped \r rides along on every value, so paths end in
  // "\r" and never prefix-match a session cwd — attribution silently returns null for all
  // Windows users.
  const lf = parseWorktreeList(REAL_PORCELAIN)
  const crlf = parseWorktreeList(REAL_PORCELAIN.replace(/\n/g, '\r\n'))
  assert.deepEqual(crlf, lf)
})

test('malformed porcelain returns what parsed instead of throwing', () => {
  // Never throw on input we did not produce: a truncated pipe or a future git format must not
  // take down the request that was merely trying to label a run.
  for (const bad of [null, undefined, 42, {}, '', '\n\n\n', 'garbage', 'branch refs/heads/x\n']) {
    assert.deepEqual(parseWorktreeList(bad), [], `input ${JSON.stringify(bad)}`)
  }
  const half = parseWorktreeList('worktree /r/a\nHEAD abc\nbranch refs/heads/b\n\nworktree /r/b\nHE')
  assert.equal(half.length, 2, 'a record cut off mid-stream is still reported by path')
  assert.equal(half[1].head, null)
})

test('a worktree line with no path is dropped rather than surfacing as a worktree at ""', () => {
  const wts = parseWorktreeList('worktree\nHEAD abc\n\nworktree /r/real\nHEAD def\n')
  assert.deepEqual(wts.map(w => w.path), ['/r/real'])
})

test('unrecognised attribute lines are preserved, not silently dropped', () => {
  // Forward compatibility: a future git attribute we do not understand must stay visible so a
  // reader can see the record was not fully interpreted.
  const wts = parseWorktreeList('worktree /r/a\nHEAD abc\nsomethingnew value here\n\n')
  assert.deepEqual(wts[0].unparsed, ['somethingnew value here'])
  assert.deepEqual(parseWorktreeList(REAL_PORCELAIN)[0].unparsed, [], 'known output leaves nothing unparsed')
})

test('a final record with no trailing blank line is still emitted', () => {
  const wts = parseWorktreeList('worktree /r/a\nHEAD abc\nbranch refs/heads/b')
  assert.equal(wts.length, 1)
  assert.equal(wts[0].branchName, 'b')
})

// ------------------------------------------------------------------------------------------
// parseGitFile / detectWorktree
// ------------------------------------------------------------------------------------------

test('a linked worktree .git file resolves to its gitdir', () => {
  // Verbatim content of the .git FILE git wrote for the linked worktree in the scratch repo.
  const { gitDir, relative } = parseGitFile('gitdir: /tmp/wt-thUVGv/main/.git/worktrees/feat-x\n')
  assert.equal(gitDir, '/tmp/wt-thUVGv/main/.git/worktrees/feat-x')
  assert.equal(relative, false)
})

test('a relative gitdir resolves against the directory holding the .git file', () => {
  // `git worktree add --relative-paths` (git 2.48+) writes a relative gitdir. Handing that
  // string on unresolved makes mainRepo depend on the process cwd.
  const { gitDir, relative } = parseGitFile('gitdir: ../main/.git/worktrees/feat-x\n', '/tmp/wt/feat-x')
  assert.equal(gitDir, path.resolve('/tmp/wt/main/.git/worktrees/feat-x'))
  assert.equal(relative, true)
})

test('a .git file with no gitdir line yields no gitdir instead of throwing', () => {
  assert.equal(parseGitFile('total nonsense\n').gitDir, null)
  assert.equal(parseGitFile('gitdir:   \n').gitDir, null)
  assert.equal(parseGitFile(null).gitDir, null)
})

test('an ordinary checkout is reported as not-a-worktree, which is an answer and not an unknown', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-main-'))
  try {
    fs.mkdirSync(path.join(dir, '.git'))
    const d = detectWorktree(dir)
    assert.equal(d.isWorktree, false)
    assert.equal(d.kind, 'main')
    assert.equal(fs.realpathSync(d.mainRepo), fs.realpathSync(dir))
    assert.equal(d.gitDir, path.join(d.mainRepo, '.git'))
    assert.equal(d.name, path.basename(dir))
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('a submodule is not mistaken for a worktree', () => {
  // The regression this guards: a submodule's .git is also a FILE with a gitdir: line, pointing
  // at <super>/.git/modules/<name>. Keying only on "the .git is a file" attributes every
  // submodule session to a worktree that does not exist.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-sub-'))
  try {
    fs.writeFileSync(path.join(dir, '.git'), 'gitdir: /super/.git/modules/vendor/thing\n')
    const d = detectWorktree(dir)
    assert.equal(d.isWorktree, false)
    assert.equal(d.kind, 'submodule')
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('an unreadable .git file is unknown, never a confident "not a worktree"', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-junk-'))
  try {
    fs.writeFileSync(path.join(dir, '.git'), 'this file is not a gitdir pointer\n')
    const d = detectWorktree(dir)
    assert.equal(d.isWorktree, null, 'unknown is a value; false would claim we checked and it is not')
    assert.equal(d.code, 'unparsable-git-file')
    assert.match(d.reason, /gitdir/)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('a directory with no repo anywhere above it reports not-a-repo', () => {
  const d = detectWorktree(os.tmpdir(), { maxAscend: 2 })
  // os.tmpdir() is not inside a repo on any sane machine; either it climbs out (not-a-repo)
  // or it exhausts the bound (ascend-limit) — both are honest, neither is "not a worktree".
  assert.ok(['not-a-repo', 'ascend-limit'].includes(d.code), `got ${d.code}`)
})

test('exhausting the parent-directory ascent bound is reported, not swallowed', () => {
  // No silent caps: a caller that hits the limit must be able to tell it apart from a real
  // "there is no repo here", because the fix (raise the bound) is completely different.
  const deep = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-deep-'))
  try {
    const leaf = path.join(deep, 'a', 'b', 'c')
    fs.mkdirSync(leaf, { recursive: true })
    const d = detectWorktree(leaf, { maxAscend: 1 })
    assert.equal(d.isWorktree, null)
    assert.equal(d.code, 'ascend-limit')
    assert.match(d.reason, /maxAscend/)
  } finally { fs.rmSync(deep, { recursive: true, force: true }) }
})

test('a bad argument is unknown with a reason rather than a thrown TypeError', () => {
  for (const bad of [null, undefined, '', '   ', 42]) {
    const d = detectWorktree(bad)
    assert.equal(d.isWorktree, null)
    assert.equal(d.code, 'bad-input')
  }
  assert.equal(MAX_ASCEND > 0, true)
})

// ------------------------------------------------------------------------------------------
// listWorktrees — failure modes. These are the point of the module.
// ------------------------------------------------------------------------------------------

test('a missing git binary yields unknown with a git-missing reason, NOT an empty list', () => {
  // THE regression this whole module exists for. Returning [] here renders as "this repo has
  // no worktrees" — a confident, wrong, unfalsifiable claim produced by not looking at all.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-nogit-'))
  try {
    const r = listWorktrees(dir, { gitBin: path.join(dir, 'definitely-not-git') })
    assert.equal(r.status, 'unknown')
    assert.equal(r.code, 'git-missing')
    assert.match(r.reason, /not found on PATH/)
    assert.equal(r.worktrees, undefined, 'no worktrees key at all — there is nothing to iterate')
    assert.deepEqual(r.argv.slice(1), ['worktree', 'list', '--porcelain'], 'argv is an array, never a shell string')
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('a directory that is not a repo is unknown/not-a-repo, distinguishable from git being absent', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-norepo-'))
  try {
    const r = listWorktrees(dir)
    assert.equal(r.status, 'unknown')
    assert.equal(r.code, gitAvailable ? 'not-a-repo' : 'git-missing')
    if (gitAvailable) assert.match(r.stderr, /not a git repository/i)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('a missing directory is dir-missing, not git-missing', () => {
  // Both surface as ENOENT out of spawnSync — cwd-not-found and binary-not-found are the same
  // errno. Conflating them sends a user to install git when their project folder was renamed.
  const r = listWorktrees(path.join(os.tmpdir(), 'wt-does-not-exist-' + Date.now()))
  assert.equal(r.status, 'unknown')
  assert.equal(r.code, 'dir-missing')
})

test('a path that is a file rather than a directory is its own reason', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-file-'))
  const f = path.join(dir, 'plain.txt')
  try {
    fs.writeFileSync(f, 'x')
    const r = listWorktrees(f)
    assert.equal(r.code, 'not-a-directory')
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('every failure mode carries a distinguishable code', () => {
  const spawn = res => () => res
  const cases = [
    [{ error: Object.assign(new Error('x'), { code: 'EACCES' }) }, 'permission-denied'],
    [{ error: Object.assign(new Error('x'), { code: 'ETIMEDOUT' }) }, 'timeout'],
    [{ error: Object.assign(new Error('x'), { code: 'ENOBUFS' }) }, 'output-truncated'],
    [{ status: null, signal: 'SIGKILL' }, 'timeout'],
    [{ status: 128, stderr: 'fatal: not a git repository' }, 'not-a-repo'],
    [{ status: 128, stderr: 'fatal: detected dubious ownership' }, 'permission-denied'],
    [{ status: 1, stderr: 'fatal: something else entirely' }, 'git-error'],
    [{ status: 0, stdout: '' }, 'empty-output'],
  ]
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-codes-'))
  try {
    const seen = new Set()
    for (const [res, code] of cases) {
      const r = listWorktrees(dir, { spawn: spawn(res) })
      assert.equal(r.status, 'unknown', `${code} must be unknown`)
      assert.equal(r.code, code)
      assert.ok(r.reason && r.reason.length > 0, `${code} must explain itself`)
      seen.add(code)
    }
    // 8 distinct failure situations collapse to 6 codes: two spellings of "we were denied" and
    // two of "git never finished" are genuinely the same answer to a caller.
    assert.equal(seen.size, 6, 'the codes are distinguishable from one another')
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('git exiting 0 with no worktrees is treated as broken, not as "zero worktrees"', () => {
  // Every real repository has at least its main worktree. An empty ok-result here would be
  // indistinguishable from the failure the whole module is built to avoid.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-empty-'))
  try {
    const r = listWorktrees(dir, { spawn: () => ({ status: 0, stdout: '\n\n' }) })
    assert.equal(r.status, 'unknown')
    assert.equal(r.code, 'empty-output')
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('git is invoked with an argv array and an explicit cwd, never through a shell', () => {
  // A repo path containing `; rm -rf ~` must be an argument, not a command. Asserting the call
  // shape is the only way to keep a future edit from reaching for a template string.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-argv-'))
  try {
    let call = null
    listWorktrees(dir, { spawn: (bin, args, o) => { call = { bin, args, o }; return { status: 0, stdout: REAL_PORCELAIN } } })
    assert.equal(call.bin, 'git')
    assert.ok(Array.isArray(call.args))
    assert.deepEqual(call.args, ['worktree', 'list', '--porcelain'])
    assert.equal(call.o.cwd, dir)
    assert.equal(call.o.shell, undefined, 'shell must never be enabled, on any platform')
    assert.ok(call.o.timeout > 0 && call.o.maxBuffer > 0, 'bounds are set explicitly')
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

// ------------------------------------------------------------------------------------------
// End-to-end against a real git repo with a real worktree.
// ------------------------------------------------------------------------------------------

test('a real repo with a real linked worktree lists and detects end to end', { skip: !gitAvailable && 'git not available' }, () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-e2e-'))
  const git = (cwd, ...args) => {
    const r = spawnSync('git', args, { cwd, encoding: 'utf8' })
    assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`)
    return r.stdout
  }
  try {
    const main = path.join(root, 'main')
    fs.mkdirSync(main)
    git(main, 'init', '-q')
    git(main, 'config', 'user.email', 'a@b.c')
    git(main, 'config', 'user.name', 'A')
    fs.writeFileSync(path.join(main, 'f.txt'), 'hi\n')
    git(main, 'add', '.')
    git(main, 'commit', '-qm', 'init')
    git(main, 'worktree', 'add', '-q', path.join(root, 'feat-x'), '-b', 'feature/x')

    const r = listWorktrees(main)
    assert.equal(r.status, 'ok', r.reason)
    assert.equal(r.worktrees.length, 2)
    const feat = r.worktrees.find(w => w.branchName === 'feature/x')
    assert.ok(feat, 'the linked worktree is listed with its branch')

    // The .git of a linked worktree really is a file, and detectWorktree resolves back to main.
    assert.equal(fs.lstatSync(path.join(root, 'feat-x', '.git')).isFile(), true)
    const d = detectWorktree(path.join(root, 'feat-x'))
    assert.equal(d.isWorktree, true)
    assert.equal(d.name, 'feat-x')
    assert.equal(fs.realpathSync(d.mainRepo), fs.realpathSync(main))

    // And a nested subdirectory of a worktree is still inside that worktree.
    const nested = path.join(root, 'feat-x', 'src', 'deep')
    fs.mkdirSync(nested, { recursive: true })
    assert.equal(detectWorktree(nested).name, 'feat-x')

    // Attribution closes the loop: a session cwd deep inside the worktree names it.
    assert.equal(attributeSession(nested, r.worktrees).path, feat.path)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
})

// ------------------------------------------------------------------------------------------
// attributeSession
// ------------------------------------------------------------------------------------------

const WTS = parseWorktreeList(REAL_PORCELAIN)

test('a session cwd inside a worktree is attributed to that worktree', () => {
  const hit = attributeSession('/tmp/wt-thUVGv/feat-x/src/app', WTS)
  assert.equal(hit.branchName, 'feature/x')
  assert.equal(hit, WTS[2], 'the entry itself is returned, so the caller keeps head/lock state')
})

test('a cwd exactly equal to a worktree root matches it', () => {
  assert.equal(attributeSession('/tmp/wt-thUVGv/locked', WTS).branchName, 'locked-branch')
})

test('the longest matching path prefix wins for nested worktrees', () => {
  // The regression this guards: nested worktrees are legal, and a plain startsWith scan returns
  // whichever matched first — usually the main checkout — so every run in a nested worktree got
  // labelled with the main branch.
  const nested = parseWorktreeList(
    'worktree /repo\nHEAD a\nbranch refs/heads/main\n\n' +
    'worktree /repo/wt/feat\nHEAD b\nbranch refs/heads/feat\n\n')
  assert.equal(attributeSession('/repo/wt/feat/src', nested).branchName, 'feat')
  assert.equal(attributeSession('/repo/src', nested).branchName, 'main')
})

test('a sibling directory sharing a name prefix is not attributed to the worktree', () => {
  // The regression this guards: `/repo/app-v2`.startsWith(`/repo/app`) is true, so without a
  // separator boundary every neighbouring directory inherits the wrong branch.
  const wts = parseWorktreeList('worktree /repo/app\nHEAD a\nbranch refs/heads/app\n\n')
  assert.equal(attributeSession('/repo/app-v2/src', wts), null)
  assert.equal(attributeSession('/repo/application', wts), null)
  assert.ok(attributeSession('/repo/app/src', wts))
})

test('a trailing slash on either side does not defeat the match', () => {
  const wts = parseWorktreeList('worktree /repo/app/\nHEAD a\nbranch refs/heads/app\n\n')
  assert.ok(attributeSession('/repo/app/', wts))
  assert.ok(attributeSession('/repo/app//src/', wts))
})

test('an unmatched cwd returns null rather than the closest worktree', () => {
  // Never a best guess: putting a branch name next to a run that never touched it is worse
  // than a blank, because a blank is legible as "we do not know".
  assert.equal(attributeSession('/somewhere/else', WTS), null)
  assert.equal(attributeSession('/tmp/wt-thUVG', WTS), null, 'a partial path component is not a match')
  assert.equal(attributeSession('/tmp', WTS), null, 'a PARENT of the worktrees is not inside one')
})

test('bad or empty inputs return null instead of throwing', () => {
  for (const bad of [null, undefined, '', 42]) assert.equal(attributeSession(bad, WTS), null)
  assert.equal(attributeSession('/tmp/wt-thUVGv/feat-x', null), null)
  assert.equal(attributeSession('/tmp/wt-thUVGv/feat-x', []), null)
  assert.equal(attributeSession('/tmp/wt-thUVGv/feat-x', [null, { path: 42 }]), null)
})

test('a listWorktrees result can be passed straight through', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-pass-'))
  try {
    const r = listWorktrees(dir, { spawn: () => ({ status: 0, stdout: REAL_PORCELAIN }) })
    assert.equal(attributeSession('/tmp/wt-thUVGv/feat-x/lib', r).branchName, 'feature/x')
    // …and an unknown result attributes nothing, because it carries no worktrees at all.
    const bad = listWorktrees(dir, { spawn: () => ({ status: 128, stderr: 'fatal: not a git repository' }) })
    assert.equal(attributeSession('/tmp/wt-thUVGv/feat-x/lib', bad), null)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('a bare repository never claims a session, since it has no working tree', () => {
  const bare = parseWorktreeList(REAL_BARE_PORCELAIN)
  assert.equal(attributeSession('/tmp/wt-thUVGv/barerepo.git/x', bare), null)
  assert.ok(attributeSession('/tmp/wt-thUVGv/barerepo.git/x', bare, { includeBare: true }), 'opt-in is available')
})

test('a prunable worktree still attributes — the run really did happen there', () => {
  assert.equal(attributeSession('/tmp/wt-thUVGv/detached/src', WTS).detached, true)
})

test('windows paths match across separator and case differences', () => {
  // The regression this guards: transcripts record `C:\Users\me\repo` while git porcelain prints
  // `C:/Users/me/repo`, so an exact string compare attributes nothing at all on Windows.
  const wts = parseWorktreeList('worktree C:/Users/Me/repo/wt\nHEAD a\nbranch refs/heads/x\n\n')
  const ci = { caseInsensitive: true }
  assert.ok(attributeSession('C:\\Users\\Me\\repo\\wt\\src', wts, ci))
  assert.ok(attributeSession('c:\\users\\me\\REPO\\wt', wts, ci))
  // Case folding is opt-in off POSIX: there, two paths differing in case are two directories.
  assert.equal(attributeSession('c:/users/me/repo/wt', wts, { caseInsensitive: false }), null)
})

test('path normalisation keeps a UNC lead but collapses inner separator runs', () => {
  assert.equal(normalizeForCompare('//server/share//dir/', { caseInsensitive: false }), '//server/share/dir')
  assert.equal(normalizeForCompare('/a//b///c/', { caseInsensitive: false }), '/a/b/c')
  assert.equal(normalizeForCompare('/', { caseInsensitive: false }), '/')
  assert.equal(normalizeForCompare('', { caseInsensitive: false }), null)
})
