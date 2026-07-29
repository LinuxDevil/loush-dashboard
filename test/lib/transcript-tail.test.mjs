import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, appendFile, rm, chmod, utimes, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createTailer, DEFAULT_MAX_CACHED_FILES } from '../../lib/transcript-tail.mjs'

// Real files, real appends. The bugs this module exists to fix only appear against a file that is
// genuinely growing on disk between reads, so nothing here is mocked.
const scratch = async () => mkdtemp(path.join(tmpdir(), 'transcript-tail-'))
const jsonl = (...objs) => objs.map(o => JSON.stringify(o)).join('\n') + '\n'

test('first sight of a file starts at EOF instead of replaying its history', async t => {
  // The 046 rule: attaching to a session already running in another terminal must not re-emit
  // every turn it has produced so far.
  const dir = await scratch()
  t.after(() => rm(dir, { recursive: true, force: true }))
  const file = path.join(dir, 's.jsonl')
  await writeFile(file, jsonl({ n: 1 }, { n: 2 }, { n: 3 }))

  const tailer = createTailer()
  const first = await tailer.tail(file)
  assert.equal(first.ok, true)
  assert.deepEqual(first.lines, [])
  assert.equal(first.firstSight, true)
  assert.equal(first.firstSightReason, 'new')
  assert.ok(first.skippedBytes > 0, 'the skipped history is reported, not silently dropped')
  assert.equal(first.offset, first.size)

  await appendFile(file, jsonl({ n: 4 }))
  const second = await tailer.tail(file)
  assert.deepEqual(second.lines.map(l => JSON.parse(l).n), [4], 'only the appended line comes back')
  assert.equal(second.firstSight, false)
})

test('fromStart opts into the whole file on first sight', async t => {
  const dir = await scratch()
  t.after(() => rm(dir, { recursive: true, force: true }))
  const file = path.join(dir, 's.jsonl')
  await writeFile(file, jsonl({ n: 1 }, { n: 2 }))

  const tailer = createTailer()
  const r = await tailer.tail(file, { fromStart: true })
  assert.deepEqual(r.lines.map(l => JSON.parse(l).n), [1, 2])
  assert.equal(r.skippedBytes, 0)
  assert.equal(r.offset, r.size)
})

test('repeated tails of an unchanged file return nothing and read no bytes', async t => {
  const dir = await scratch()
  t.after(() => rm(dir, { recursive: true, force: true }))
  const file = path.join(dir, 's.jsonl')
  await writeFile(file, jsonl({ n: 1 }))

  const tailer = createTailer()
  await tailer.tail(file, { fromStart: true })
  const idle = await tailer.tail(file)
  assert.deepEqual(idle.lines, [])
  assert.equal(idle.bytesRead, 0)
  assert.equal(idle.truncated, false)
})

test('a read ending mid-line carries the fragment forward instead of dropping it', async t => {
  // The regression this guards: the upstream tailer split on '\n' and discarded the trailing
  // element, so any record that happened to be half-written at read time vanished permanently —
  // the reader never went back for it, because the offset had already moved past those bytes.
  const dir = await scratch()
  t.after(() => rm(dir, { recursive: true, force: true }))
  const file = path.join(dir, 's.jsonl')
  await writeFile(file, '')

  const tailer = createTailer()
  await tailer.tail(file)

  await appendFile(file, '{"n":1}\n{"n":2,"hal')
  const mid = await tailer.tail(file)
  assert.deepEqual(mid.lines.map(l => JSON.parse(l).n), [1], 'only the complete line is emitted')
  assert.ok(mid.partialBytes > 0, 'the held fragment is reported')
  assert.equal(mid.offset, mid.size, 'the fragment bytes are consumed but not yet delivered')

  await appendFile(file, 'f":true}\n')
  const done = await tailer.tail(file)
  assert.equal(done.lines.length, 1)
  assert.deepEqual(JSON.parse(done.lines[0]), { n: 2, half: true }, 'the fragment is rejoined, not lost')
  assert.equal(done.partialBytes, 0)
})

test('a line split one byte at a time survives reassembly', async t => {
  // Worst-case interleaving of appends and reads: every single tail() lands mid-line.
  const dir = await scratch()
  t.after(() => rm(dir, { recursive: true, force: true }))
  const file = path.join(dir, 's.jsonl')
  await writeFile(file, '')

  const tailer = createTailer()
  await tailer.tail(file)

  const payload = '{"msg":"hello world"}\n'
  const seen = []
  for (const ch of payload) {
    await appendFile(file, ch)
    const r = await tailer.tail(file)
    seen.push(...r.lines)
  }
  assert.deepEqual(seen, ['{"msg":"hello world"}'])
})

test('a multi-byte character split across two reads is not corrupted', async t => {
  // A UTF-8 sequence straddling an append boundary decodes to U+FFFD if each chunk is stringified
  // independently. Transcripts are full of non-ASCII, so this shows up as mangled content.
  const dir = await scratch()
  t.after(() => rm(dir, { recursive: true, force: true }))
  const file = path.join(dir, 's.jsonl')
  await writeFile(file, '')

  const tailer = createTailer()
  await tailer.tail(file)

  const bytes = Buffer.from('{"t":"héllo — ok"}\n', 'utf8')
  for (let i = 0; i < bytes.length; i += 3) {
    await appendFile(file, bytes.subarray(i, i + 3))
    await tailer.tail(file)
  }
  const finalRead = await tailer.read(file)
  assert.equal(finalRead.records[0].t, 'héllo — ok')

  // And through the tail path itself, in one more split pass.
  const t2 = createTailer()
  await t2.tail(file)
  await appendFile(file, Buffer.from('{"t":"ü"}', 'utf8').subarray(0, 8))
  const partial = await t2.tail(file)
  assert.deepEqual(partial.lines, [])
  await appendFile(file, Buffer.concat([Buffer.from('{"t":"ü"}', 'utf8').subarray(8), Buffer.from('\n')]))
  const rest = await t2.tail(file)
  assert.equal(JSON.parse(rest.lines[0]).t, 'ü')
})

test('a file truncated below the last offset resets and says so', async t => {
  // The regression this guards: after a rotation the old offset points into the middle of new
  // content, so continuing from it emits a spliced half-line as if it were a record.
  const dir = await scratch()
  t.after(() => rm(dir, { recursive: true, force: true }))
  const file = path.join(dir, 's.jsonl')
  await writeFile(file, jsonl({ n: 1 }, { n: 2 }, { n: 3 }))

  const tailer = createTailer()
  await tailer.tail(file, { fromStart: true })

  await writeFile(file, jsonl({ fresh: true }))
  const after = await tailer.tail(file)
  assert.equal(after.reset, true)
  assert.equal(after.offset, after.size)
  assert.deepEqual(after.lines.map(l => JSON.parse(l)), [{ fresh: true }], 'the replacement is read whole, from 0')
})

test('a stale partial fragment is discarded on truncation rather than glued to new content', async t => {
  const dir = await scratch()
  t.after(() => rm(dir, { recursive: true, force: true }))
  const file = path.join(dir, 's.jsonl')
  await writeFile(file, '')

  const tailer = createTailer()
  await tailer.tail(file)
  await appendFile(file, '{"old":tru')
  const held = await tailer.tail(file)
  assert.ok(held.partialBytes > 0)

  await writeFile(file, jsonl({ n: 9 }))
  const after = await tailer.tail(file)
  assert.equal(after.reset, true)
  assert.deepEqual(after.lines.map(l => JSON.parse(l).n), [9])
  assert.equal(after.partialBytes, 0)
})

test('a same-length rewrite is flagged rather than reported as no change', async t => {
  // Unknown is a value: we cannot distinguish an in-place rewrite from a bare touch, so we say
  // "suspected" instead of guessing (re-emitting would duplicate, silence would hide a rewrite).
  const dir = await scratch()
  t.after(() => rm(dir, { recursive: true, force: true }))
  const file = path.join(dir, 's.jsonl')
  await writeFile(file, jsonl({ n: 1 }))

  const tailer = createTailer()
  await tailer.tail(file, { fromStart: true })

  const before = await stat(file)
  await writeFile(file, jsonl({ n: 2 })) // identical length, different content
  const bumped = new Date(before.mtimeMs + 5000)
  await utimes(file, bumped, bumped)

  const after = await tailer.tail(file)
  assert.equal(after.rewriteSuspected, true)
  assert.equal(after.bytesRead, 0)
})

test('the parse cache is keyed on mtime as well as size', async t => {
  // The regression this guards: keying on size alone served the pre-rewrite records forever for
  // any edit that happened to preserve the file length.
  const dir = await scratch()
  t.after(() => rm(dir, { recursive: true, force: true }))
  const file = path.join(dir, 's.jsonl')
  await writeFile(file, jsonl({ n: 1 }))

  const tailer = createTailer()
  const a = await tailer.read(file)
  assert.equal(a.cached, false)
  assert.deepEqual(a.records, [{ n: 1 }])

  const b = await tailer.read(file)
  assert.equal(b.cached, true, 'an unchanged file is not re-parsed')

  const before = await stat(file)
  await writeFile(file, jsonl({ n: 2 })) // same byte length
  const bumped = new Date(before.mtimeMs + 5000)
  await utimes(file, bumped, bumped)

  const c = await tailer.read(file)
  assert.equal(c.cached, false, 'a changed mtime invalidates even at identical size')
  assert.deepEqual(c.records, [{ n: 2 }])
  assert.equal(tailer.stats().parseCacheHits, 1)
})

test('one malformed line does not cost the rest of the file', async t => {
  // Half-written trailing records are normal in a live transcript; a whole-file JSON.parse or a
  // try/catch around the loop would throw away thousands of good records over one of them.
  const dir = await scratch()
  t.after(() => rm(dir, { recursive: true, force: true }))
  const file = path.join(dir, 's.jsonl')
  await writeFile(file, '{"n":1}\nnot json at all\n{"n":2}\n')

  const tailer = createTailer()
  const r = await tailer.read(file)
  assert.equal(r.ok, true)
  assert.deepEqual(r.records, [{ n: 1 }, { n: 2 }])
  assert.equal(r.malformed.length, 1, 'the bad line is reported, not silently skipped')
  assert.equal(r.malformed[0].line, 'not json at all')
  assert.equal(r.malformed[0].index, 1)
})

test('tail returns raw lines so a malformed record cannot break the batch', async t => {
  const dir = await scratch()
  t.after(() => rm(dir, { recursive: true, force: true }))
  const file = path.join(dir, 's.jsonl')
  await writeFile(file, '')

  const tailer = createTailer()
  await tailer.tail(file)
  await appendFile(file, '{"n":1}\n{oops\n{"n":2}\n')
  const r = await tailer.tail(file)
  assert.deepEqual(r.lines, ['{"n":1}', '{oops', '{"n":2}'])
})

test('an unreadable file surfaces the error and never looks like "no new data"', async t => {
  // House rule: a permission or missing-file failure must not be indistinguishable from an idle
  // file. `lines` is null so a caller iterating it fails loudly instead of seeing zero records.
  const dir = await scratch()
  t.after(() => rm(dir, { recursive: true, force: true }))
  const tailer = createTailer()

  const missing = await tailer.tail(path.join(dir, 'nope.jsonl'))
  assert.equal(missing.ok, false)
  assert.equal(missing.lines, null)
  assert.equal(missing.error.code, 'ENOENT')

  const readFail = await tailer.read(path.join(dir, 'nope.jsonl'))
  assert.equal(readFail.ok, false)
  assert.equal(readFail.records, null)
  assert.equal(readFail.error.code, 'ENOENT')

  if (process.getuid && process.getuid() !== 0) {
    const locked = path.join(dir, 'locked.jsonl')
    await writeFile(locked, jsonl({ n: 1 }))
    await chmod(locked, 0o000)
    t.after(() => chmod(locked, 0o600).catch(() => {}))
    const denied = await tailer.tail(locked)
    assert.equal(denied.ok, false)
    assert.equal(denied.lines, null)
    assert.equal(denied.error.code, 'EACCES')
  }
})

test('a read larger than the per-call cap reports how much it left behind', async t => {
  // No silent caps: a capped result is explicitly incomplete, with the byte count still pending,
  // so a caller can loop instead of treating a partial batch as the whole append.
  const dir = await scratch()
  t.after(() => rm(dir, { recursive: true, force: true }))
  const file = path.join(dir, 's.jsonl')
  await writeFile(file, '')

  const tailer = createTailer({ maxBytesPerRead: 64 })
  await tailer.tail(file)

  const rows = Array.from({ length: 40 }, (_, i) => ({ i }))
  await appendFile(file, jsonl(...rows))

  const collected = []
  let guard = 0
  let r
  do {
    r = await tailer.tail(file)
    collected.push(...r.lines)
    if (r.truncated) assert.ok(r.pendingBytes > 0, 'a capped read states the remaining bytes')
    assert.ok(++guard < 100)
  } while (r.truncated)

  assert.equal(collected.length, 40, 'capping splits the batch but never drops a line')
  assert.deepEqual(collected.map(l => JSON.parse(l).i), rows.map(r2 => r2.i))
  assert.ok(tailer.stats().readCapHits > 0, 'cap hits are counted for the operator')
})

test('the LRU evicts the least recently tailed file and counts it', async t => {
  const dir = await scratch()
  t.after(() => rm(dir, { recursive: true, force: true }))
  const files = []
  for (let i = 0; i < 4; i++) {
    const f = path.join(dir, `s${i}.jsonl`)
    await writeFile(f, jsonl({ i }))
    files.push(f)
  }

  const tailer = createTailer({ maxCachedFiles: 2 })
  await tailer.tail(files[0])
  await tailer.tail(files[1])
  await tailer.tail(files[0]) // touch: files[1] is now the oldest
  await tailer.tail(files[2])

  const s = tailer.stats()
  assert.equal(s.files, 2)
  assert.equal(s.evictions, 1)

  // A file whose state was evicted re-enters as a first sight, and says the offset loss was an
  // eviction rather than a genuinely new file — those are very different for a caller.
  const back = await tailer.tail(files[1])
  assert.equal(back.firstSight, true)
  assert.equal(back.firstSightReason, 'evicted')
})

test('forget and clear drop per-file state, and stats reports the bounds in force', async t => {
  const dir = await scratch()
  t.after(() => rm(dir, { recursive: true, force: true }))
  const file = path.join(dir, 's.jsonl')
  await writeFile(file, jsonl({ n: 1 }))

  const tailer = createTailer()
  await tailer.tail(file, { fromStart: true })
  assert.equal(tailer.stats().files, 1)
  assert.equal(tailer.stats().maxCachedFiles, DEFAULT_MAX_CACHED_FILES)

  assert.equal(tailer.forget(file), true)
  assert.equal(tailer.forget(file), false)
  assert.equal(tailer.stats().files, 0)

  await tailer.tail(file)
  tailer.clear()
  assert.equal(tailer.stats().files, 0)
})

test('carried fragments are visible in stats so a stuck writer is diagnosable', async t => {
  // A partial line held forever means a producer wrote a record and died mid-line; the byte count
  // is exposed rather than hidden inside the tailer.
  const dir = await scratch()
  t.after(() => rm(dir, { recursive: true, force: true }))
  const file = path.join(dir, 's.jsonl')
  await writeFile(file, '')
  const tailer = createTailer()
  await tailer.tail(file)
  await appendFile(file, '{"stuck":')
  await tailer.tail(file)
  assert.equal(tailer.stats().carriedBytes, Buffer.byteLength('{"stuck":'))
})

test('two tailers over the same file keep independent offsets', async t => {
  const dir = await scratch()
  t.after(() => rm(dir, { recursive: true, force: true }))
  const file = path.join(dir, 's.jsonl')
  await writeFile(file, jsonl({ n: 1 }))

  const a = createTailer()
  const b = createTailer()
  await a.tail(file, { fromStart: true })
  await appendFile(file, jsonl({ n: 2 }))

  const ra = await a.tail(file)
  const rb = await b.tail(file, { fromStart: true })
  assert.deepEqual(ra.lines.map(l => JSON.parse(l).n), [2])
  assert.deepEqual(rb.lines.map(l => JSON.parse(l).n), [1, 2])
})

test('blank lines between records are not emitted as records', async t => {
  const dir = await scratch()
  t.after(() => rm(dir, { recursive: true, force: true }))
  const file = path.join(dir, 's.jsonl')
  await writeFile(file, '{"n":1}\n\n\n{"n":2}\n')
  const tailer = createTailer()
  const r = await tailer.tail(file, { fromStart: true })
  assert.deepEqual(r.lines.map(l => JSON.parse(l).n), [1, 2])
})

test('an append landing between the stat and the read is left for the next call', async t => {
  // The regression this guards: upstream stat'd the path, then opened and read to EOF, so bytes
  // appended in between were read but not accounted for in the offset — and delivered twice on
  // the following call. The explicit `end` makes offset == the exact byte we stopped at.
  const dir = await scratch()
  t.after(() => rm(dir, { recursive: true, force: true }))
  const file = path.join(dir, 's.jsonl')
  await writeFile(file, '')
  const tailer = createTailer()
  await tailer.tail(file)

  await appendFile(file, jsonl({ n: 1 }))
  // Racing writer: fires while tail() is in flight.
  const racing = appendFile(file, jsonl({ n: 2 }))
  const r = await tailer.tail(file)
  await racing

  const secondBatch = await tailer.tail(file)
  const all = [...r.lines, ...secondBatch.lines].map(l => JSON.parse(l).n)
  assert.deepEqual(all, [1, 2], 'every line delivered exactly once, in order')

  const final = await stat(file)
  assert.equal(secondBatch.offset, final.size, 'the offset lands exactly on EOF, never past it')
})
