// Tests for lib/git-watch.mjs — event-driven watching against REAL repositories.
//
// These are inherently timing-sensitive: they perform a real `git commit` and wait for a real inotify
// event. Every wait is bounded by an explicit timeout that FAILS the test rather than hanging, and
// the bound is named in the failure message so a slow CI box reports "waited 4000ms for
// git:commit-detected" instead of a mystery timeout.

import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { watchRepo, EVENTS, WATCH_DEFAULTS } from '../../lib/git-watch.mjs'
import { tmpRepo, write, commitAll, sh, cleanupAll } from './git-fixture.test.mjs'

after(cleanupAll)

const WAIT_MS = 5000
const open = []
const start = (dir, opts) => { const w = watchRepo(dir, { debounceMs: 30, ...opts }); open.push(w); return w }
after(() => { for (const w of open) { try { w.dispose() } catch { /* already disposed */ } } })

/** Resolve on the first `event`, or reject with a message naming the bound we waited. */
function waitFor(w, event, ms = WAIT_MS) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`waited ${ms}ms for ${event} and it never fired`)), ms)
    w.emitter.once(event, payload => { clearTimeout(t); resolve(payload) })
  })
}

/** Collect every `event` seen during `ms`, then resolve. Used to prove events STOP. */
function collect(w, event, ms) {
  const seen = []
  w.emitter.on(event, p => seen.push(p))
  return new Promise(r => setTimeout(() => r(seen), ms))
}

test('a healthy repo establishes the essential watches and reports each target', () => {
  const dir = tmpRepo('watch-ok')
  write(dir, 'a.txt', 'x\n'); commitAll(dir, 'base')
  const w = start(dir)

  assert.equal(w.ok, true, `expected watches to establish; reason=${w.reason}`)
  const byTarget = Object.fromEntries(w.watches.map(x => [x.target, x]))
  for (const t of ['index', 'HEAD', 'refs-heads-dir']) {
    assert.ok(byTarget[t], `no report for ${t}`)
    assert.equal(byTarget[t].ok, true, `${t}: ${byTarget[t].reason}`)
  }
  assert.ok(w.gitDir.endsWith('.git'))
  assert.equal(w.head.branch, 'main')
  assert.match(w.head.sha, /^[0-9a-f]{40}$/)
  w.dispose()
})

test('an absent optional target (packed-refs) is reported as absent, not as success', () => {
  const dir = tmpRepo('watch-packed')
  write(dir, 'a.txt', 'x\n'); commitAll(dir, 'base')
  const w = start(dir)
  const pr = w.watches.find(x => x.target === 'packed-refs')
  assert.ok(pr, 'packed-refs must appear in the report even when it does not exist')
  if (!fs.existsSync(path.join(dir, '.git', 'packed-refs'))) {
    assert.equal(pr.ok, false)
    assert.equal(pr.reason, 'absent', 'an absent file is named, never silently treated as watched')
  }
  w.dispose()
})

test('a directory that is not a repo REPORTS the failure and tells the caller to poll', () => {
  const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'watch-notrepo-'))
  const w = start(plain)
  assert.equal(w.ok, false)
  assert.equal(w.reason, 'not-a-git-repo')
  assert.equal(w.fallback, 'poll', 'the caller must be able to fall back KNOWINGLY')
  assert.ok(w.pollIntervalMs > 0, 'and is told at what cadence')
  assert.deepEqual(w.watches, [], 'nothing is being watched, and it says so')
  w.dispose()
  fs.rmSync(plain, { recursive: true, force: true })
})

test('a failure to establish emits git:watch-error, so silence is never mistaken for calm', async () => {
  const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'watch-err-'))
  const w = start(plain)
  const payload = await waitFor(w, EVENTS.WATCH_ERROR, 2000)
  assert.equal(payload.fallback, 'poll')
  assert.ok(payload.reason)
  w.dispose()
  fs.rmSync(plain, { recursive: true, force: true })
})

test('a real commit emits git:commit-detected with the old and new sha', async () => {
  const dir = tmpRepo('watch-commit')
  write(dir, 'a.txt', 'x\n'); commitAll(dir, 'base')
  const w = start(dir)
  assert.equal(w.ok, true, w.reason)
  const before = w.head.sha

  const p = waitFor(w, EVENTS.COMMIT_DETECTED)
  write(dir, 'a.txt', 'y\n')
  sh(dir, ['add', '-A'])
  sh(dir, ['commit', '-q', '-m', 'second'])

  const ev = await p
  assert.equal(ev.from, before)
  assert.notEqual(ev.to, before)
  assert.equal(ev.branch, 'main')
  assert.equal(ev.to, sh(dir, ['rev-parse', 'HEAD']).stdout.trim())
  w.dispose()
})

test('staging emits git:status-changed', async () => {
  const dir = tmpRepo('watch-stage')
  write(dir, 'a.txt', 'x\n'); commitAll(dir, 'base')
  const w = start(dir)
  assert.equal(w.ok, true, w.reason)

  const p = waitFor(w, EVENTS.STATUS_CHANGED)
  write(dir, 'a.txt', 'y\n')
  sh(dir, ['add', '-A'])
  const ev = await p
  assert.equal(ev.headKnown, true)
  assert.equal(ev.shaChanged, false, 'staging is not a commit')
  w.dispose()
})

test('watching SURVIVES the lock-and-rename — a second stage is seen, not just the first', async () => {
  // The regression this guards is not "no events" but "one event, then silence forever". git writes
  // index.lock and renames it over .git/index, which detaches a file watch from the live inode; on
  // darwin the .git/index watch delivers exactly one event and the .git/HEAD watch delivers none.
  // A watcher that reports ok:true and has been deaf since its first notification is the worst
  // possible state, because every surface downstream reads it as "nothing has changed".
  const dir = tmpRepo('watch-survives')
  write(dir, 'a.txt', 'x\n'); commitAll(dir, 'base')
  const w = start(dir)
  assert.equal(w.ok, true, w.reason)

  for (const round of ['y', 'z', 'w']) {
    const p = waitFor(w, EVENTS.STATUS_CHANGED)
    write(dir, 'a.txt', `${round}\n`)
    sh(dir, ['add', '-A'])
    await p // rejects with a named bound if this round went unseen
  }
  w.dispose()
})

test('a BRANCH SWITCH is detected, not just a commit', async () => {
  const dir = tmpRepo('watch-branch')
  write(dir, 'a.txt', 'x\n'); commitAll(dir, 'base')
  sh(dir, ['branch', 'feature'])
  const w = start(dir)
  assert.equal(w.ok, true, w.reason)

  const p = waitFor(w, EVENTS.BRANCH_CHANGED)
  sh(dir, ['checkout', '-q', 'feature'])
  const ev = await p
  assert.equal(ev.from, 'main')
  assert.equal(ev.to, 'feature')
  assert.equal(ev.detached, false)
  w.dispose()
})

test('switching to a branch at the SAME commit is still detected (HEAD-only change)', async () => {
  // This is the case an index-or-refs-only watch misses entirely: no ref moves, no index changes,
  // only .git/HEAD is rewritten.
  const dir = tmpRepo('watch-samesha')
  write(dir, 'a.txt', 'x\n'); commitAll(dir, 'base')
  sh(dir, ['branch', 'twin'])
  const w = start(dir)
  const shaBefore = w.head.sha

  const p = waitFor(w, EVENTS.BRANCH_CHANGED)
  sh(dir, ['checkout', '-q', 'twin'])
  const ev = await p
  assert.equal(ev.to, 'twin')
  assert.equal(ev.sha, shaBefore, 'the sha did not move — only the branch did')
  w.dispose()
})

test('a branch switch is NOT reported as a commit, even though the sha moves', async () => {
  const dir = tmpRepo('watch-nofakecommit')
  write(dir, 'a.txt', '1\n'); commitAll(dir, 'base')
  sh(dir, ['checkout', '-q', '-b', 'ahead'])
  write(dir, 'a.txt', '2\n'); commitAll(dir, 'more')
  sh(dir, ['checkout', '-q', 'main'])

  const w = start(dir)
  const commits = []
  w.emitter.on(EVENTS.COMMIT_DETECTED, e => commits.push(e))
  const p = waitFor(w, EVENTS.BRANCH_CHANGED)
  sh(dir, ['checkout', '-q', 'ahead'])
  await p
  await new Promise(r => setTimeout(r, 250))
  assert.deepEqual(commits, [], 'a checkout must not put a phantom commit in the activity feed')
  w.dispose()
})

test('DEBOUNCE: one commit produces ONE status-changed, not the raw fs.watch burst', async () => {
  const dir = tmpRepo('watch-debounce')
  write(dir, 'a.txt', 'x\n'); commitAll(dir, 'base')
  const w = start(dir, { debounceMs: 120 })
  assert.equal(w.ok, true, w.reason)

  const p = waitFor(w, EVENTS.COMMIT_DETECTED)
  const seen = collect(w, EVENTS.STATUS_CHANGED, 900)
  write(dir, 'a.txt', 'y\n')
  sh(dir, ['add', '-A'])
  sh(dir, ['commit', '-q', '-m', 'one commit'])
  await p
  const events = await seen
  // A single `git commit` touches index, index.lock, the ref, the ref lock and the reflog — five or
  // more inotify events. Debounced, that is one notification.
  assert.equal(events.length, 1, `expected 1 debounced event, got ${events.length}`)
})

test('DISPOSAL actually stops events and closes every handle', async () => {
  const dir = tmpRepo('watch-dispose')
  write(dir, 'a.txt', 'x\n'); commitAll(dir, 'base')
  const w = start(dir, { debounceMs: 20 })
  assert.equal(w.ok, true, w.reason)

  // Prove it is live first — otherwise "no events after dispose" proves nothing.
  const first = waitFor(w, EVENTS.STATUS_CHANGED)
  write(dir, 'a.txt', 'y\n'); sh(dir, ['add', '-A'])
  await first

  const after1 = []
  w.emitter.on(EVENTS.STATUS_CHANGED, e => after1.push(e))
  w.emitter.on(EVENTS.COMMIT_DETECTED, e => after1.push(e))
  w.dispose()
  assert.equal(w.disposed, true)

  write(dir, 'a.txt', 'z\n')
  sh(dir, ['add', '-A'])
  sh(dir, ['commit', '-q', '-m', 'after dispose'])
  await new Promise(r => setTimeout(r, 600))
  assert.deepEqual(after1, [], 'a disposed watcher must be silent')
  assert.equal(w.emitter.listenerCount(EVENTS.STATUS_CHANGED), 0, 'no leaked listeners')
})

test('dispose() is idempotent and safe from inside a handler', async () => {
  const dir = tmpRepo('watch-dispose2')
  write(dir, 'a.txt', 'x\n'); commitAll(dir, 'base')
  const w = start(dir, { debounceMs: 20 })

  // Bounded like every other wait in this file. Unbounded, this was the one place a missed event
  // became an unkillable hang instead of a failure: `node --test` runs with no per-test timeout, so
  // the whole suite stopped here forever rather than reporting which assertion did not hold.
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`waited ${WAIT_MS}ms for ${EVENTS.STATUS_CHANGED} and it never fired`)), WAIT_MS)
    w.emitter.once(EVENTS.STATUS_CHANGED, () => { clearTimeout(t); w.dispose(); resolve() })
    write(dir, 'a.txt', 'y\n'); sh(dir, ['add', '-A'])
  })
  assert.doesNotThrow(() => { w.dispose(); w.dispose() })
})

test('the short cache is invalidated by an event, and only lives for its TTL', async () => {
  const dir = tmpRepo('watch-cache')
  write(dir, 'a.txt', 'x\n'); commitAll(dir, 'base')
  const w = start(dir, { debounceMs: 20, cacheTtlMs: 5000 })

  w.putCache({ fake: 'status' })
  assert.deepEqual(w.cached(), { fake: 'status' })

  const p = waitFor(w, EVENTS.STATUS_CHANGED)
  write(dir, 'a.txt', 'y\n'); sh(dir, ['add', '-A'])
  await p
  assert.equal(w.cached(), null, 'a filesystem change must invalidate the cache immediately')

  const short = start(dir, { cacheTtlMs: 0 })
  short.putCache({ x: 1 })
  assert.equal(short.cached(), null, 'a zero TTL caches nothing')
  w.dispose(); short.dispose()
})

test('defaults are exported so a caller can see the debounce and poll cadence in force', () => {
  assert.ok(WATCH_DEFAULTS.debounceMs > 0)
  assert.ok(WATCH_DEFAULTS.pollIntervalMs > 0)
  const dir = tmpRepo('watch-defaults')
  write(dir, 'a.txt', 'x\n'); commitAll(dir, 'base')
  const w = watchRepo(dir)
  assert.equal(w.pollIntervalMs, WATCH_DEFAULTS.pollIntervalMs)
  w.dispose()
})

test('watchRepo never throws on hostile input', () => {
  for (const bad of [null, '', 42, {}, '/definitely/not/here']) {
    let w
    assert.doesNotThrow(() => { w = watchRepo(bad) })
    assert.equal(w.ok, false)
    assert.ok(w.reason, 'a refusal is always named')
    assert.equal(w.fallback, 'poll')
    w.dispose()
  }
})
