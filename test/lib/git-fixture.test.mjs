// test/lib/git-fixture.test.mjs — REAL git repositories in os.tmpdir(), shared by the git-* tests.
//
// It carries the `.test.mjs` suffix only because the brief's file allowlist for this batch is
// `test/lib/*.test.mjs`; it is a helper module. Not a mock. The whole point of these tests is that the porcelain format, the seven unmerged states
// and the -z rename framing are whatever the installed git actually emits — a hand-written fixture
// would only prove the parser agrees with my memory of the format.

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const made = []

export function sh(dir, args, opts = {}) {
  const r = spawnSync('git', args, {
    cwd: dir, encoding: 'utf8',
    env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@e.x', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@e.x', LC_ALL: 'C' },
    ...opts,
  })
  return r
}

export function tmpRepo(name = 'repo') {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `gitfix-${name}-`))
  made.push(dir)
  const init = sh(dir, ['init', '-q', '-b', 'main', '.'])
  if (init.status !== 0) throw new Error(`git init failed: ${init.stderr}`)
  sh(dir, ['config', 'user.name', 't'])
  sh(dir, ['config', 'user.email', 't@e.x'])
  sh(dir, ['config', 'commit.gpgsign', 'false'])
  sh(dir, ['config', 'core.autocrlf', 'false'])
  return dir
}

export function write(dir, rel, content) {
  const p = path.join(dir, rel)
  fs.mkdirSync(path.dirname(p), { recursive: true })
  fs.writeFileSync(p, content)
  return p
}

export function commitAll(dir, msg) {
  sh(dir, ['add', '-A'])
  const r = sh(dir, ['commit', '-q', '-m', msg])
  if (r.status !== 0) throw new Error(`commit failed: ${r.stderr}`)
}

/** A repo left mid-merge with ALL SEVEN porcelain v1 unmerged states present at once. */
export function conflictedRepo() {
  const dir = tmpRepo('conflict')
  write(dir, 'm.txt', 'l1\nl2\n')
  write(dir, 'd1.txt', 'x\n')
  write(dir, 'd2.txt', 'y\n')
  write(dir, 'rr.txt', 'base\n')
  commitAll(dir, 'base')

  sh(dir, ['checkout', '-q', '-b', 'other'])
  write(dir, 'm.txt', 'l1\nTHEIRS\n')
  sh(dir, ['rm', '-q', 'd1.txt'])
  write(dir, 'd2.txt', 'y-theirs\n')
  write(dir, 'add.txt', 'theirs\n')
  sh(dir, ['mv', 'rr.txt', 'their-name.txt'])
  commitAll(dir, 'theirs')

  sh(dir, ['checkout', '-q', 'main'])
  write(dir, 'm.txt', 'l1\nOURS\n')
  write(dir, 'd1.txt', 'x-ours\n')
  sh(dir, ['rm', '-q', 'd2.txt'])
  write(dir, 'add.txt', 'ours\n')
  sh(dir, ['mv', 'rr.txt', 'our-name.txt'])
  commitAll(dir, 'ours')

  sh(dir, ['merge', 'other']) // expected to conflict
  return dir
}

export function cleanupAll() {
  for (const d of made.splice(0)) {
    try { fs.rmSync(d, { recursive: true, force: true }) } catch { /* tmp cleanup is best-effort */ }
  }
}

// NOTE: this file intentionally declares no tests of its own. Under `node --test` each file is its
// own process, so any test declared here would be re-registered and re-run by every file that imports
// these helpers. The assertions about what real git emits live in git-status.test.mjs.
