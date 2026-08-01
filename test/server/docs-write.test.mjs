// The WRITE path, as distinct from the path guard that `docs.test.mjs` covers.
//
// Both escapes pinned here got past a guard that was, on its own terms, correct: the name it
// checked really did resolve inside the root. They are here because a name check cannot see them.
//
//   * a HARDLINK is a second true name for one inode. `lstat` reports an ordinary file and
//     `realpath` reports a path inside the root — both accurate — while the bytes written through
//     it land in a file that also has a name outside the root.
//   * a mid-path directory component swapped for a symlink AFTER the guard ran. `O_NOFOLLOW`
//     applies to the final component only, so it never covered this case.
//
// The fix is `writeContained`: resolve the parent through the kernel immediately before the open,
// write an `O_EXCL` temp file there, and `rename` it into place. `rename` acts on the directory
// entry, so it breaks a hardlink and replaces a symlink rather than writing through either.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import express from 'express'
import mountDocs, { writeContained } from '../../server/docs.mjs'

const TMP = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'docs-write-')))
const ROOT = path.join(TMP, 'docs')
const OUTSIDE = path.join(TMP, 'outside')
fs.mkdirSync(ROOT, { recursive: true })
fs.mkdirSync(OUTSIDE, { recursive: true })

let links = true
try { fs.symlinkSync(OUTSIDE, path.join(TMP, 'probe')) } catch { links = false }

// `fs.rmSync` on a symlink-to-directory reports EISDIR, and its `recursive` form would delete the
// TARGET's contents — exactly what these tests must not do. Unlink the link itself.
const unlinkAny = p => {
  let st
  try { st = fs.lstatSync(p) } catch { return }
  if (st.isDirectory()) fs.rmSync(p, { recursive: true, force: true })
  else fs.unlinkSync(p)
}

const app = express()
app.use(express.json({ limit: '4mb' }))
mountDocs(app, { root: ROOT, runAgent: async () => ({ result: 'unused' }) })
const server = app.listen(0, '127.0.0.1')
await new Promise(r => server.once('listening', r))
const base = `http://127.0.0.1:${server.address().port}`
test.after(() => server.close())

const put = async (p, text) => {
  const res = await fetch(`${base}/api/docs/file?path=${encodeURIComponent(p)}`, {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }),
  })
  return { status: res.status, body: await res.json().catch(() => null) }
}

// ------------------------------------------------------------------------------------ hardlinks

test('PUT through a hardlink to a file outside the root does not touch the outside file', async () => {
  const victim = path.join(OUTSIDE, 'hardlinked.md')
  fs.writeFileSync(victim, 'ORIGINAL')
  const inside = path.join(ROOT, 'hard.md')
  try { fs.linkSync(victim, inside) } catch { return }   // filesystem refuses hardlinks: nothing to test

  // The guard passes it, correctly — there is no symlink and the path really is inside the root.
  const r = await put('hard.md', 'ATTACKER')
  assert.equal(r.status, 200, 'a hardlink is an ordinary file; refusing it is not the fix')

  assert.equal(fs.readFileSync(victim, 'utf8'), 'ORIGINAL', 'the file OUTSIDE the root must be untouched')
  assert.equal(fs.readFileSync(inside, 'utf8'), 'ATTACKER', 'the name INSIDE the root gets the new content')
  assert.notEqual(fs.statSync(inside).ino, fs.statSync(victim).ino, 'rename broke the link, which is the point')
  assert.equal(fs.statSync(victim).nlink, 1)
})

// ------------------------------------------------------------------------------- mid-path swaps

test('a directory component replaced by a symlink between the guard and the write cannot escape',
  { skip: !links && 'symlinks unavailable' }, () => {
    // Simulated deterministically rather than raced: call the write primitive with the parent
    // ALREADY swapped, which is the state a winning racer would produce. A racer is not a
    // regression test — it passes on a slow machine for the wrong reason.
    const victimDir = path.join(OUTSIDE, 'swapped')
    fs.mkdirSync(victimDir, { recursive: true })
    const swapped = path.join(ROOT, 'swapped')
    unlinkAny(swapped)
    fs.symlinkSync(victimDir, swapped)

    const out = writeContained(ROOT, path.join(swapped, 'g.md'), 'ESCAPED')
    assert.deepEqual(out, { ok: false, reason: 'symlink-escapes-root' })
    assert.equal(fs.existsSync(path.join(victimDir, 'g.md')), false, 'nothing was written outside the root')
    assert.deepEqual(fs.readdirSync(victimDir), [], 'not even a temp file')
    unlinkAny(swapped)
  })

test('a LEAF replaced by a symlink is overwritten, not followed', { skip: !links && 'symlinks unavailable' }, () => {
  const victim = path.join(OUTSIDE, 'leaf.md')
  fs.writeFileSync(victim, 'ORIGINAL')
  const leaf = path.join(ROOT, 'leaf.md')
  unlinkAny(leaf)
  fs.symlinkSync(victim, leaf)

  // The guard would refuse this name; writeContained is asserted independently of the guard,
  // because the whole reason it exists is that the guard's answer is stale by the time we write.
  const out = writeContained(ROOT, leaf, 'REPLACEMENT')
  assert.equal(out.ok, true)
  assert.equal(fs.readFileSync(victim, 'utf8'), 'ORIGINAL')
  assert.equal(fs.lstatSync(leaf).isSymbolicLink(), false, 'the link was replaced by a real file')
  assert.equal(fs.readFileSync(leaf, 'utf8'), 'REPLACEMENT')
})

// -------------------------------------------------------------------- and it must still work

test('ordinary writes, nested creates and overwrites still succeed', async () => {
  assert.equal((await put('plain.md', 'A')).status, 200)
  assert.equal(fs.readFileSync(path.join(ROOT, 'plain.md'), 'utf8'), 'A')
  assert.equal((await put('plain.md', 'B')).status, 200)
  assert.equal(fs.readFileSync(path.join(ROOT, 'plain.md'), 'utf8'), 'B')
  assert.equal((await put('a/b/c/deep.md', 'C')).status, 200)
  assert.equal(fs.readFileSync(path.join(ROOT, 'a/b/c/deep.md'), 'utf8'), 'C')
})

test('the write is atomic: concurrent PUTs leave one whole version, never a splice', async () => {
  const bodies = Array.from({ length: 24 }, (_, i) => String(i).repeat(4000))
  const rs = await Promise.all(bodies.map(b => put('race.md', b)))
  assert.deepEqual([...new Set(rs.map(r => r.status))], [200])
  const final = fs.readFileSync(path.join(ROOT, 'race.md'), 'utf8')
  assert.ok(bodies.includes(final), 'the file is exactly one of the writes, not a mixture of two')
})

test('no temp file is left behind, and the listing would hide one anyway', async () => {
  await put('tidy.md', 'x')
  assert.deepEqual(fs.readdirSync(ROOT).filter(n => n.endsWith('.tmp')), [])
})

test('a directory where the file should be is a 400, not a 500', async () => {
  fs.mkdirSync(path.join(ROOT, 'adir.md'), { recursive: true })
  const r = await put('adir.md', 'x')
  assert.equal(r.status, 400)
  assert.equal(r.body.error, 'not-a-file')
})

test('a root that is itself a symlink still resolves and still contains', { skip: !links && 'symlinks unavailable' }, () => {
  const real = path.join(TMP, 'realroot')
  const link = path.join(TMP, 'linkroot')
  fs.mkdirSync(real, { recursive: true })
  unlinkAny(link)
  fs.symlinkSync(real, link)
  assert.equal(writeContained(link, path.join(link, 'ok.md'), 'HELLO').ok, true)
  assert.equal(fs.readFileSync(path.join(real, 'ok.md'), 'utf8'), 'HELLO')
  assert.deepEqual(writeContained(link, path.join(real, '..', 'outside', 'x.md'), 'NO'),
    { ok: false, reason: 'symlink-escapes-root' })
})
