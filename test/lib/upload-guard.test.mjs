import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { safeName, dirUsage, planUpload, MAX_UPLOAD_BYTES, MAX_DIR_BYTES, MAX_NAME_LENGTH } from '../../lib/upload-guard.mjs'

const withDir = (files, fn) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'uploadguard-'))
  try {
    let t = Date.now() - 100_000
    for (const [name, bytes] of Object.entries(files)) {
      const p = path.join(root, name)
      fs.writeFileSync(p, Buffer.alloc(bytes))
      t += 1000
      fs.utimesSync(p, t / 1000, t / 1000)   // deterministic age ordering
    }
    return fn(root)
  } finally { fs.rmSync(root, { recursive: true, force: true }) }
}

const NUL = String.fromCharCode(0)

test('a traversal attempt is reduced to its basename', () => {
  assert.equal(safeName('../../etc/passwd'), 'passwd')
  assert.equal(safeName('/etc/shadow'), 'shadow')
  // Backslashes are not separators on posix, so they survive basename — the charset filter is
  // what stops them, and no separator of either kind survives into the result.
  const win = safeName('..\\..\\windows\\system32')
  assert.ok(!win.includes('\\') && !win.includes('/'), win)
})

test('a NUL byte cannot truncate the name at the syscall boundary', () => {
  // Without the control-character strip this basenames to the whole string, and the kernel then
  // sees only `shell.php` — the extension the caller thought it was getting is gone.
  assert.equal(safeName('shell.php' + NUL + '.png'), 'shell.php.png')
  assert.equal(safeName('a' + String.fromCharCode(9) + 'b'), 'ab', 'tabs and other control chars go too')
})

test('a name that sanitises to nothing is refused rather than given a fallback', () => {
  for (const bad of ['.', '..', '/', '...', '', null, undefined, 42, {}]) {
    assert.equal(safeName(bad), null, JSON.stringify(bad))
  }
})

test('a leading dot cannot create a hidden file', () => {
  assert.equal(safeName('.bashrc'), 'bashrc')
  assert.equal(safeName('..hidden.txt'), 'hidden.txt')
})

test('an absurdly long name is truncated but keeps its extension', () => {
  const n = safeName('a'.repeat(5000) + '.tar.gz')
  assert.ok(n.length <= MAX_NAME_LENGTH)
  assert.ok(n.endsWith('.gz'), 'the extension is what the CLI uses to decide how to read it')
})

test('ordinary names survive intact', () => {
  assert.equal(safeName('report-2026.final.pdf'), 'report-2026.final.pdf')
  assert.equal(safeName('my file (1).txt'), 'my_file__1_.txt')
})

// ---- quota ----

test('an empty upload is refused with a reason', () => {
  withDir({}, d => {
    assert.deepEqual(planUpload(d, 'a.txt', 0), { ok: false, reason: 'empty-upload' })
    assert.equal(planUpload(d, 'a.txt', NaN).reason, 'empty-upload')
    assert.equal(planUpload(d, 'a.txt', -5).reason, 'empty-upload')
  })
})

test('a file over the per-file cap is refused, and the cap is named', () => {
  withDir({}, d => {
    const r = planUpload(d, 'big.bin', MAX_UPLOAD_BYTES + 1)
    assert.equal(r.ok, false)
    assert.equal(r.reason, 'file-too-large')
    assert.equal(r.limit, MAX_UPLOAD_BYTES, 'the bound must be reported, not applied silently')
    assert.equal(r.size, MAX_UPLOAD_BYTES + 1)
  })
})

test('an upload that fits inside the quota needs no eviction', () => {
  withDir({ 'old.bin': 100 }, d => {
    const r = planUpload(d, 'new.txt', 50, { maxDirBytes: 1000 })
    assert.equal(r.ok, true)
    assert.deepEqual(r.evict, [])
    assert.equal(r.freed, 0)
    assert.ok(r.path.startsWith(path.resolve(d) + path.sep))
    assert.ok(r.path.endsWith('new.txt'))
  })
})

test('over quota, the oldest files are evicted first and only as many as needed', () => {
  withDir({ 'a.bin': 300, 'b.bin': 300, 'c.bin': 300 }, d => {
    const r = planUpload(d, 'new.bin', 200, { maxDirBytes: 1000 })
    assert.equal(r.ok, true)
    assert.deepEqual(r.evict.map(f => f.name), ['a.bin'], 'one eviction frees enough; b and c stay')
    assert.equal(r.freed, 300)
  })
})

test('eviction continues until the new file actually fits', () => {
  withDir({ 'a.bin': 100, 'b.bin': 100, 'c.bin': 100 }, d => {
    const r = planUpload(d, 'new.bin', 280, { maxDirBytes: 300 })
    assert.deepEqual(r.evict.map(f => f.name), ['a.bin', 'b.bin', 'c.bin'])
  })
})

test('a file larger than the whole quota is refused rather than emptying the directory', () => {
  withDir({ 'a.bin': 100 }, d => {
    const r = planUpload(d, 'huge.bin', 5000, { maxDirBytes: 1000 })
    assert.equal(r.ok, false)
    assert.equal(r.reason, 'exceeds-quota')
    assert.equal(r.limit, 1000)
    assert.equal(r.evict, undefined, 'nothing may be deleted for an upload that can never succeed')
  })
})

test('the written path is always inside the upload directory', () => {
  withDir({}, d => {
    const root = path.resolve(d)
    for (const name of ['../escape.txt', '/etc/passwd', 'a/../../b.txt', '....//x']) {
      const r = planUpload(d, name, 10)
      if (!r.ok) continue
      assert.ok(r.path.startsWith(root + path.sep), `${name} escaped to ${r.path}`)
      assert.equal(path.dirname(r.path), root)
    }
  })
})

test('a timestamp prefix keeps same-named uploads from clobbering each other', () => {
  withDir({}, d => {
    const a = planUpload(d, 'x.txt', 10, { now: 1000 })
    const b = planUpload(d, 'x.txt', 10, { now: 2000 })
    assert.notEqual(a.path, b.path)
  })
})

test('usage of a missing directory is zero, not a crash', () => {
  assert.deepEqual(dirUsage('/nonexistent/nope'), { bytes: 0, files: [] })
})

test('usage totals real bytes and orders oldest first', () => {
  withDir({ 'a.bin': 10, 'b.bin': 20 }, d => {
    const u = dirUsage(d)
    assert.equal(u.bytes, 30)
    assert.deepEqual(u.files.map(f => f.name), ['a.bin', 'b.bin'])
  })
})

test('subdirectories are not counted as uploads', () => {
  withDir({ 'a.bin': 10 }, d => {
    fs.mkdirSync(path.join(d, 'sub'))
    fs.writeFileSync(path.join(d, 'sub', 'x.bin'), Buffer.alloc(9999))
    assert.equal(dirUsage(d).bytes, 10)
  })
})

test('the shipped defaults are the ones the route advertises', () => {
  assert.equal(MAX_UPLOAD_BYTES, 25 * 1024 * 1024)
  assert.equal(MAX_DIR_BYTES, 500 * 1024 * 1024)
})
