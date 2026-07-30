// Tests for lib/git-ops.mjs — status/diff/stage/unstage/commit/branches against real repositories.

import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { status, diff, stage, unstage, commit, listBranches, resolveInRepo, OPS_LIMITS } from '../../lib/git-ops.mjs'
import { tmpRepo, write, commitAll, sh, conflictedRepo, cleanupAll } from './git-fixture.test.mjs'

after(cleanupAll)

const find = (res, p) => res.entries.find(e => e.pathDisplay === p)

// ---------------------------------------------------------------------------------------------
// status

test('status reports entries, branch, counts and the modes/limits that produced them', () => {
  const dir = tmpRepo('ops-status')
  write(dir, 'tracked.txt', 'a\n'); commitAll(dir, 'base')
  write(dir, 'tracked.txt', 'b\n')
  write(dir, 'new.txt', 'x\n')

  const res = status(dir)
  assert.equal(res.ok, true)
  assert.equal(res.branch.branch, 'main')
  assert.equal(find(res, 'tracked.txt').unstaged, true)
  assert.equal(find(res, 'new.txt').untracked, true)
  // House rule 2: the caller can see how this listing was bounded.
  assert.equal(res.untrackedMode, 'normal')
  assert.equal(res.ignoredIncluded, false)
  assert.equal(res.truncated, false)
  assert.ok(res.limits.maxEntries > 0)
})

test('status on a directory that is not a repo returns a named reason, not a throw', () => {
  const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-notrepo-'))
  let res
  assert.doesNotThrow(() => { res = status(plain) })
  assert.equal(res.ok, false)
  assert.equal(res.reason, 'not-a-git-repo')
  fs.rmSync(plain, { recursive: true, force: true })
})

test('status surfaces conflicts as conflicts', () => {
  const res = status(conflictedRepo())
  assert.equal(res.ok, true)
  assert.equal(res.counts.conflicted, 7)
  assert.ok(res.entries.filter(e => e.conflicted).every(e => e.indexStatus === null))
})

test('status maxEntries truncation is reported', () => {
  const dir = tmpRepo('ops-trunc')
  for (let i = 0; i < 10; i++) write(dir, `f${i}.txt`, 'x\n')
  const res = status(dir, { maxEntries: 3 })
  assert.equal(res.entries.length, 3)
  assert.equal(res.truncated, true)
  assert.equal(res.limits.maxEntries, 3)
})

// ---------------------------------------------------------------------------------------------
// path containment

test('resolveInRepo refuses traversal, symlink escape, the repo root and .git', () => {
  const dir = tmpRepo('contain')
  write(dir, 'inside.txt', 'x\n')
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-outside-'))
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'boo\n')
  fs.symlinkSync(outside, path.join(dir, 'escape'))

  assert.equal(resolveInRepo(dir, 'inside.txt').ok, true)
  assert.equal(resolveInRepo(dir, '../../etc/passwd').reason, 'path-outside-repository')
  assert.equal(resolveInRepo(dir, '/etc/passwd').reason, 'path-outside-repository')
  // The symlink is INSIDE the repo but points out of it — this is why containment runs on realpath.
  assert.equal(resolveInRepo(dir, 'escape/secret.txt').reason, 'path-outside-repository')
  assert.equal(resolveInRepo(dir, '.').reason, 'path-is-repo-root')
  assert.equal(resolveInRepo(dir, '.git/config').reason, 'path-inside-git-dir')
  assert.equal(resolveInRepo(dir, 'a\0b').reason, 'path-contains-nul')
  assert.equal(resolveInRepo(dir, '').reason, 'path-empty')
  assert.equal(resolveInRepo(dir, null).reason, 'path-empty')
  // A path that does not exist yet still resolves (staging a deletion).
  assert.equal(resolveInRepo(dir, 'not/created/yet.txt').ok, true)
  fs.rmSync(outside, { recursive: true, force: true })
})

test('a sibling directory whose name merely shares a prefix is outside', () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'prefix-'))
  fs.mkdirSync(path.join(base, 'proj'))
  fs.mkdirSync(path.join(base, 'proj-secrets'))
  const r = resolveInRepo(path.join(base, 'proj'), path.join(base, 'proj-secrets', 'x.txt'))
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'path-outside-repository')
  fs.rmSync(base, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------------------------
// stage / unstage

test('stage stages exactly the named path, and unstage removes it again', () => {
  const dir = tmpRepo('ops-stage')
  write(dir, 'a.txt', 'a\n'); write(dir, 'b.txt', 'b\n')
  commitAll(dir, 'base')
  write(dir, 'a.txt', 'a2\n'); write(dir, 'b.txt', 'b2\n')

  const s = stage(dir, ['a.txt'])
  assert.equal(s.ok, true)
  assert.deepEqual(s.staged, ['a.txt'])
  let st = status(dir)
  assert.equal(find(st, 'a.txt').staged, true)
  assert.equal(find(st, 'b.txt').staged, false)

  const u = unstage(dir, ['a.txt'])
  assert.equal(u.ok, true, u.reason)
  st = status(dir)
  assert.equal(find(st, 'a.txt').staged, false)
  assert.equal(find(st, 'a.txt').unstaged, true)
})

test('stage handles a path with a space and a quote', () => {
  const dir = tmpRepo('ops-oddname')
  const name = 'has space and "quote".txt'
  write(dir, name, 'x\n')
  const s = stage(dir, [name])
  assert.equal(s.ok, true, s.reason)
  assert.equal(find(status(dir), name).staged, true)
})

test('stage works in a repository with NO commits yet, and unstage does too', () => {
  const dir = tmpRepo('ops-nocommits')
  write(dir, 'first.txt', 'x\n')
  assert.equal(stage(dir, ['first.txt']).ok, true)
  const u = unstage(dir, ['first.txt'])
  // `git reset HEAD --` would fail here because HEAD does not resolve; `restore --staged` does not.
  assert.equal(u.ok, true, `unstage failed: ${u.reason} ${u.stderr || ''}`)
  assert.equal(find(status(dir), 'first.txt').untracked, true)
})

test('staging a path OUTSIDE the repository is refused, and stages nothing at all', () => {
  const dir = tmpRepo('ops-escape')
  write(dir, 'ok.txt', 'x\n')
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-out-'))
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'boo\n')

  for (const bad of ['../../etc/passwd', path.join(outside, 'secret.txt'), '.git/config']) {
    const r = stage(dir, [bad])
    assert.equal(r.ok, false, `${bad} must be refused`)
    assert.equal(r.reason, 'path-refused')
    assert.equal(r.refused.length, 1)
    assert.ok(r.refused[0].check, 'the failing check is named')
  }
  // A mixed batch fails as a WHOLE — no partial staging.
  const mixed = stage(dir, ['ok.txt', '../../etc/passwd'])
  assert.equal(mixed.ok, false)
  assert.equal(sh(dir, ['diff', '--cached', '--name-only']).stdout.trim(), '', 'nothing staged')
})

test('stage rejects a non-array, an empty list, and a list over the cap — with the cap named', () => {
  const dir = tmpRepo('ops-stagelimits')
  assert.equal(stage(dir, 'a.txt').reason, 'paths-must-be-array')
  assert.equal(stage(dir, []).reason, 'paths-empty')
  const many = stage(dir, Array.from({ length: OPS_LIMITS.maxPaths + 1 }, (_, i) => `f${i}.txt`))
  assert.equal(many.reason, 'too-many-paths')
  assert.equal(many.max, OPS_LIMITS.maxPaths)
  assert.equal(many.given, OPS_LIMITS.maxPaths + 1)
})

// ---------------------------------------------------------------------------------------------
// diff

test('diff returns unstaged changes, and --cached returns staged ones', () => {
  const dir = tmpRepo('ops-diff')
  write(dir, 'f.txt', 'one\n'); commitAll(dir, 'base')
  write(dir, 'f.txt', 'two\n'); stage(dir, ['f.txt'])
  write(dir, 'f.txt', 'three\n')

  const staged = diff(dir, { staged: true })
  assert.equal(staged.ok, true)
  assert.match(staged.diff, /\+two/)
  assert.equal(staged.staged, true)

  const worktree = diff(dir, {})
  assert.match(worktree.diff, /\+three/)
  assert.equal(worktree.truncated, false)
  assert.equal(worktree.bytesLimit, OPS_LIMITS.maxDiffBytes)
})

test('diff truncation reports the byte bound and the true total', () => {
  const dir = tmpRepo('ops-bigdiff')
  write(dir, 'f.txt', 'base\n'); commitAll(dir, 'base')
  write(dir, 'f.txt', Array.from({ length: 3000 }, (_, i) => `line ${i}`).join('\n'))
  const d = diff(dir, { maxBytes: 200 })
  assert.equal(d.ok, true)
  assert.equal(d.truncated, true, 'a short diff must never be silently short')
  assert.equal(d.bytes, 200)
  assert.ok(d.totalBytes > 200)
  assert.equal(d.bytesLimit, 200)
})

test('diff refuses an out-of-repo path rather than diffing it', () => {
  const dir = tmpRepo('ops-diffescape')
  write(dir, 'f.txt', 'x\n'); commitAll(dir, 'base')
  const r = diff(dir, { path: '../../etc/passwd' })
  assert.equal(r.ok, false)
  assert.equal(r.reason, 'path-refused')
})

test('a file named like a flag is treated as a path, not an option', () => {
  const dir = tmpRepo('ops-flagname')
  write(dir, '--output=pwned', 'x\n')
  commitAll(dir, 'base')
  write(dir, '--output=pwned', 'y\n')
  const d = diff(dir, { path: '--output=pwned' })
  assert.equal(d.ok, true, d.reason)
  assert.match(d.diff, /\+y/)
})

// ---------------------------------------------------------------------------------------------
// commit

test('an empty or whitespace-only commit message is REFUSED before git is ever spawned', () => {
  const dir = tmpRepo('ops-emptymsg')
  write(dir, 'f.txt', 'x\n'); stage(dir, ['f.txt'])
  const before = sh(dir, ['rev-list', '--count', '--all']).stdout.trim()

  assert.equal(commit(dir, '').reason, 'commit-message-empty')
  assert.equal(commit(dir, '   \n\t ').reason, 'commit-message-empty')
  assert.equal(commit(dir, undefined).reason, 'commit-message-required')
  assert.equal(commit(dir, null).reason, 'commit-message-required')
  assert.equal(commit(dir, 42).reason, 'commit-message-required')
  assert.equal(commit(dir, 'has\0nul').reason, 'commit-message-contains-nul')
  const long = commit(dir, 'x'.repeat(OPS_LIMITS.maxCommitMessageBytes + 1))
  assert.equal(long.reason, 'commit-message-too-long')
  assert.equal(long.max, OPS_LIMITS.maxCommitMessageBytes)

  assert.equal(sh(dir, ['rev-list', '--count', '--all']).stdout.trim(), before, 'no commit was attempted')
})

test('a real commit returns the new sha, verbatim message preserved', () => {
  const dir = tmpRepo('ops-commit')
  write(dir, 'f.txt', 'x\n')
  assert.equal(stage(dir, ['f.txt']).ok, true)
  const msg = 'subject line\n\nbody with "quotes" and $VARS and `ticks`\n'
  const c = commit(dir, msg)
  assert.equal(c.ok, true, `${c.reason} ${c.stderr || ''}`)
  assert.match(c.sha, /^[0-9a-f]{40}$/)
  assert.equal(sh(dir, ['log', '-1', '--format=%B']).stdout.replace(/\n+$/, ''), msg.replace(/\n+$/, ''))
})

test('committing with nothing staged is a named refusal, not exit code 1', () => {
  const dir = tmpRepo('ops-nothing')
  write(dir, 'f.txt', 'x\n'); commitAll(dir, 'base')
  const c = commit(dir, 'nothing to see')
  assert.equal(c.ok, false)
  assert.equal(c.reason, 'nothing-staged')
})

test('committing with unresolved conflicts is refused by name', () => {
  const c = commit(conflictedRepo(), 'merging')
  assert.equal(c.ok, false)
  assert.equal(c.reason, 'unresolved-conflicts')
  assert.equal(c.conflicted, 7)
})

test('allowEmpty lets an empty commit through deliberately', () => {
  const dir = tmpRepo('ops-allowempty')
  write(dir, 'f.txt', 'x\n'); commitAll(dir, 'base')
  const c = commit(dir, 'empty on purpose', { allowEmpty: true })
  assert.equal(c.ok, true, c.reason)
  assert.equal(c.allowEmpty, true)
})

// ---------------------------------------------------------------------------------------------
// branches

test('listBranches reports every local branch, the current one, and null upstream', () => {
  const dir = tmpRepo('ops-branches')
  write(dir, 'f.txt', 'x\n'); commitAll(dir, 'base')
  sh(dir, ['branch', 'feature/one'])
  sh(dir, ['branch', 'has-no-upstream'])

  const b = listBranches(dir)
  assert.equal(b.ok, true)
  const names = b.branches.map(x => x.name).sort()
  assert.deepEqual(names, ['feature/one', 'has-no-upstream', 'main'])
  assert.equal(b.current, 'main')
  assert.equal(b.branches.find(x => x.name === 'main').current, true)
  assert.equal(b.branches.find(x => x.name === 'feature/one').upstream, null, 'no upstream is null, not ""')
  assert.match(b.branches[0].sha, /^[0-9a-f]{40}$/)
  assert.equal(b.branches.find(x => x.name === 'main').subject, 'base')
})

test('listBranches survives a branch name and subject containing spaces and quotes', () => {
  const dir = tmpRepo('ops-oddbranch')
  write(dir, 'f.txt', 'x\n')
  stage(dir, ['f.txt'])
  commit(dir, 'a "quoted" subject; with $meta')
  sh(dir, ['branch', 'feature/with-dash_and.dot'])
  const b = listBranches(dir)
  assert.equal(b.ok, true)
  assert.ok(b.branches.some(x => x.name === 'feature/with-dash_and.dot'))
  assert.equal(b.branches.find(x => x.name === 'main').subject, 'a "quoted" subject; with $meta')
})

test('listBranches finds PACKED refs (no file under .git/refs/heads)', () => {
  const dir = tmpRepo('ops-packed')
  write(dir, 'f.txt', 'x\n'); commitAll(dir, 'base')
  sh(dir, ['branch', 'packed-away'])
  sh(dir, ['pack-refs', '--all'])
  assert.equal(fs.existsSync(path.join(dir, '.git', 'refs', 'heads', 'packed-away')), false, 'ref is packed')
  const b = listBranches(dir)
  assert.ok(b.branches.some(x => x.name === 'packed-away'))
})

test('detached HEAD: current is null and detached is true — unknown is a value', () => {
  const dir = tmpRepo('ops-detached')
  write(dir, 'f.txt', 'x\n'); commitAll(dir, 'base')
  sh(dir, ['checkout', '-q', sh(dir, ['rev-parse', 'HEAD']).stdout.trim()])
  const b = listBranches(dir)
  assert.equal(b.ok, true)
  assert.equal(b.current, null)
  assert.equal(b.detached, true)
  assert.equal(b.branches.every(x => !x.current), true)
})

test('listBranches truncation is reported with its bound', () => {
  const dir = tmpRepo('ops-manybranches')
  write(dir, 'f.txt', 'x\n'); commitAll(dir, 'base')
  for (let i = 0; i < 5; i++) sh(dir, ['branch', `b${i}`])
  const b = listBranches(dir, { max: 2 })
  assert.equal(b.branches.length, 2)
  assert.equal(b.truncated, true)
  assert.equal(b.max, 2)
})

// ---------------------------------------------------------------------------------------------
// the locked case is visible through every operation

test('every operation reports locked:true rather than pretending the repo is clean', () => {
  const dir = tmpRepo('ops-locked')
  write(dir, 'f.txt', 'x\n'); commitAll(dir, 'base')
  write(dir, 'f.txt', 'y\n')
  fs.writeFileSync(path.join(dir, '.git', 'index.lock'), '')
  try {
    const s = stage(dir, ['f.txt'])
    assert.equal(s.ok, false)
    assert.equal(s.locked, true, `stage stderr: ${s.stderr}`)
    assert.equal(s.reason, 'repo-locked')

    const c = commit(dir, 'while locked')
    assert.equal(c.ok, false, 'a commit under a held lock must not silently succeed')
  } finally {
    fs.unlinkSync(path.join(dir, '.git', 'index.lock'))
  }
})
