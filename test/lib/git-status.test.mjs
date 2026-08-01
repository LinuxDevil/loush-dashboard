// Tests for lib/git-status.mjs — the porcelain v1 -z parser.
//
// Everything that CAN be produced by real git IS produced by real git (temp repos in os.tmpdir()).
// Synthetic buffers appear only where the input is by definition malformed — a truncated stream is
// not something git will emit on request.

import { test, after } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { parsePorcelainV1Z, parseBranchHeader, UNMERGED_STATES, STATUS_LIMITS } from '../../lib/git-status.mjs'
import { tmpRepo, write, commitAll, sh, conflictedRepo, cleanupAll } from './git-fixture.test.mjs'

after(cleanupAll)

const raw = dir => sh(dir, ['status', '--porcelain=v1', '-z']).stdout
const rawBuf = dir => sh(dir, ['status', '--porcelain=v1', '-z'], { encoding: 'buffer' }).stdout
const byPath = (res, p) => res.entries.find(e => e.pathDisplay === p)

// ---------------------------------------------------------------------------------------------
// what real git actually emits — the format facts the parser is built on

test('real git -z frames a rename as NEW-path record then ORIGIN field', () => {
  const dir = tmpRepo('framing')
  write(dir, 'old name.txt', 'x\n')
  commitAll(dir, 'base')
  sh(dir, ['mv', 'old name.txt', 'new "q" name.txt'])
  const fields = raw(dir).split('\0')
  assert.equal(fields[0], 'R  new "q" name.txt', 'the record carries the NEW path')
  assert.equal(fields[1], 'old name.txt', 'the ORIGIN is the field AFTER it')
  assert.equal(fields[2], '', 'every field is NUL-TERMINATED, not NUL-separated')
})

test('real git -z never C-quotes a path (the reason we do not parse the newline format)', () => {
  const dir = tmpRepo('quoting')
  write(dir, 'sp ace "q".txt', 'x\n')
  assert.ok(raw(dir).includes('sp ace "q".txt'))
  assert.match(sh(dir, ['status', '--porcelain=v1']).stdout, /^\?\? "/m)
})

// ---------------------------------------------------------------------------------------------
// renames: the two-field rule

test('a rename against real git yields ONE entry with both paths', () => {
  const dir = tmpRepo('rename')
  write(dir, 'old name.txt', 'x\n')
  write(dir, 'other.txt', 'y\n')
  commitAll(dir, 'base')
  sh(dir, ['mv', 'old name.txt', 'new name.txt'])

  const res = parsePorcelainV1Z(rawBuf(dir))
  assert.equal(res.ok, true)
  const e = byPath(res, 'new name.txt')
  assert.ok(e, 'renamed entry present under its NEW path')
  assert.equal(e.renamed, true)
  assert.equal(e.origPath, 'old name.txt')
  assert.equal(e.xy, 'R ')
  assert.equal(e.staged, true, 'git mv stages the rename')
  assert.equal(e.unstaged, false)
})

test('a rename does NOT shift the entries that follow it — the classic -z bug', () => {
  const dir = tmpRepo('rename-shift')
  for (const n of ['a.txt', 'b.txt', 'c.txt', 'd.txt']) write(dir, n, 'x\n')
  commitAll(dir, 'base')
  sh(dir, ['mv', 'a.txt', 'a-renamed.txt'])
  write(dir, 'b.txt', 'changed\n')
  write(dir, 'zz-new.txt', 'new\n')

  const res = parsePorcelainV1Z(rawBuf(dir))
  assert.equal(res.ok, true)
  // If the origin field were consumed as a record, 'a.txt' would appear as a bogus entry and the
  // paths of everything after it would be off by one.
  assert.equal(byPath(res, 'a.txt'), undefined, 'the ORIGIN path must not become its own entry')
  assert.equal(byPath(res, 'a-renamed.txt').origPath, 'a.txt')
  assert.equal(byPath(res, 'b.txt').unstaged, true)
  assert.equal(byPath(res, 'b.txt').renamed, false)
  assert.equal(byPath(res, 'zz-new.txt').untracked, true)
  assert.equal(res.counts.renamed, 1)
})

test('two renames back to back stay aligned', () => {
  const dir = tmpRepo('rename-twice')
  write(dir, 'one.txt', '1\n'); write(dir, 'two.txt', '2\n'); write(dir, 'three.txt', '3\n')
  commitAll(dir, 'base')
  sh(dir, ['mv', 'one.txt', 'uno.txt'])
  sh(dir, ['mv', 'two.txt', 'dos.txt'])
  write(dir, 'three.txt', 'iii\n')

  const res = parsePorcelainV1Z(rawBuf(dir))
  assert.equal(res.entries.length, 3)
  assert.equal(byPath(res, 'uno.txt').origPath, 'one.txt')
  assert.equal(byPath(res, 'dos.txt').origPath, 'two.txt')
  assert.equal(byPath(res, 'three.txt').origPath, null)
})

test('a truncated rename record is a NAMED failure, never a best-effort parse', () => {
  // Synthetic: git would not emit this, which is exactly why it must not be guessed past.
  const buf = Buffer.from('R  new.txt\0') // origin field missing
  const res = parsePorcelainV1Z(buf)
  assert.equal(res.ok, false)
  assert.equal(res.reason, 'rename-missing-origin')
  assert.equal(res.at, 0)
})

// ---------------------------------------------------------------------------------------------
// conflicts

test('all seven unmerged states from a REAL merge conflict are reported as conflicts', () => {
  const dir = conflictedRepo()
  const res = parsePorcelainV1Z(rawBuf(dir))
  assert.equal(res.ok, true)

  const seen = new Map(res.entries.filter(e => e.conflicted).map(e => [e.xy, e]))
  for (const code of Object.keys(UNMERGED_STATES)) {
    assert.ok(seen.has(code), `real git emitted no ${code}; saw ${[...seen.keys()].join(',')}`)
    const e = seen.get(code)
    assert.equal(e.conflict.code, code)
    assert.equal(e.conflict.label, UNMERGED_STATES[code].label)
    assert.equal(e.conflict.ours, UNMERGED_STATES[code].ours)
    assert.equal(e.conflict.theirs, UNMERGED_STATES[code].theirs)
  }
  assert.equal(res.counts.conflicted, 7)
})

test('a conflict is NEVER reported as an ordinary modification/add/delete', () => {
  const dir = conflictedRepo()
  const res = parsePorcelainV1Z(rawBuf(dir))
  for (const e of res.entries.filter(x => x.conflicted)) {
    assert.equal(e.indexStatus, null, `${e.xy} must not carry a plain index status`)
    assert.equal(e.worktreeStatus, null, `${e.xy} must not carry a plain worktree status`)
    assert.equal(e.staged, false, `${e.xy} must not look stageable-and-done`)
    assert.equal(e.unstaged, false)
  }
})

test('AA/DD/AU/UA/DU/UD are only conflicts as EXACT pairs — AM and AD are not', () => {
  const res = parsePorcelainV1Z(Buffer.from('AM a.txt\0AD b.txt\0DM c.txt\0 M d.txt\0'))
  assert.equal(res.ok, true)
  assert.equal(res.counts.conflicted, 0)
  assert.equal(byPath(res, 'a.txt').indexStatus, 'added')
  assert.equal(byPath(res, 'a.txt').worktreeStatus, 'modified')
  assert.equal(byPath(res, 'b.txt').worktreeStatus, 'deleted')
})

test('UU is both-modified and UD is deleted-by-THEM, not a worktree delete', () => {
  const dir = conflictedRepo()
  const res = parsePorcelainV1Z(rawBuf(dir))
  const uu = res.entries.find(e => e.xy === 'UU')
  const ud = res.entries.find(e => e.xy === 'UD')
  assert.equal(uu.conflict.label, 'both modified')
  assert.equal(ud.conflict.label, 'deleted by them')
  assert.equal(ud.conflict.theirs, 'deleted')
  assert.equal(ud.conflict.ours, 'unmerged')
})

// ---------------------------------------------------------------------------------------------
// staged vs unstaged are two independent columns

test('a file can be BOTH staged and unstaged (MM), against real git', () => {
  const dir = tmpRepo('mm')
  write(dir, 'f.txt', 'one\n')
  commitAll(dir, 'base')
  write(dir, 'f.txt', 'two\n')
  sh(dir, ['add', 'f.txt'])
  write(dir, 'f.txt', 'three\n')

  const res = parsePorcelainV1Z(rawBuf(dir))
  const e = byPath(res, 'f.txt')
  assert.equal(e.xy, 'MM')
  assert.equal(e.staged, true)
  assert.equal(e.unstaged, true)
  assert.equal(e.indexStatus, 'modified')
  assert.equal(e.worktreeStatus, 'modified')
  assert.equal(res.counts.staged, 1)
  assert.equal(res.counts.unstaged, 1)
})

test('staged-only and unstaged-only are distinguished', () => {
  const dir = tmpRepo('columns')
  write(dir, 'staged.txt', 'a\n'); write(dir, 'dirty.txt', 'a\n')
  commitAll(dir, 'base')
  write(dir, 'staged.txt', 'b\n'); sh(dir, ['add', 'staged.txt'])
  write(dir, 'dirty.txt', 'b\n')

  const res = parsePorcelainV1Z(rawBuf(dir))
  assert.deepEqual(
    [byPath(res, 'staged.txt').staged, byPath(res, 'staged.txt').unstaged], [true, false])
  assert.deepEqual(
    [byPath(res, 'dirty.txt').staged, byPath(res, 'dirty.txt').unstaged], [false, true])
})

test('untracked and ignored are neither staged nor unstaged', () => {
  const dir = tmpRepo('untracked')
  write(dir, '.gitignore', 'ignored.txt\n')
  commitAll(dir, 'base')
  write(dir, 'new.txt', 'x\n')
  write(dir, 'ignored.txt', 'x\n')
  const res = parsePorcelainV1Z(sh(dir, ['status', '--porcelain=v1', '-z', '--ignored=matching'], { encoding: 'buffer' }).stdout)
  const n = byPath(res, 'new.txt'), i = byPath(res, 'ignored.txt')
  assert.deepEqual([n.untracked, n.staged, n.unstaged, n.indexStatus], [true, false, false, null])
  assert.deepEqual([i.ignored, i.staged, i.unstaged], [true, false, false])
})

// ---------------------------------------------------------------------------------------------
// hostile paths

test('a path with a space and a double quote survives byte-for-byte', () => {
  const dir = tmpRepo('quotepath')
  const name = 'has space and "quote".txt'
  write(dir, name, 'x\n')
  const res = parsePorcelainV1Z(rawBuf(dir))
  const e = byPath(res, name)
  assert.ok(e, `expected an entry for ${name}`)
  assert.equal(e.path, name)
  assert.equal(Buffer.from(e.pathBytesBase64, 'base64').toString('utf8'), name)
  assert.equal(e.pathEncoding, 'utf8')
})

test('shell metacharacters in a filename are just bytes', () => {
  const dir = tmpRepo('metachars')
  const name = "x; rm -rf $(echo hi) `id` && ok'.txt"
  write(dir, name, 'x\n')
  const res = parsePorcelainV1Z(rawBuf(dir))
  assert.ok(byPath(res, name), 'the whole name is one path')
  assert.equal(res.entries.length, 1)
})

test('a newline INSIDE a filename does not split the record (this is why -z exists)', () => {
  const dir = tmpRepo('newlinepath')
  const name = 'two\nlines.txt'
  fs.writeFileSync(path.join(dir, name), 'x\n')
  const res = parsePorcelainV1Z(rawBuf(dir))
  assert.equal(res.entries.length, 1)
  assert.equal(res.entries[0].path, name)
})

test('a NON-UTF-8 filename is preserved as bytes and reported as unknown TEXT, not mangled silently', () => {
  const dir = tmpRepo('latin1')
  const bytes = Buffer.concat([Buffer.from('caf'), Buffer.from([0xe9]), Buffer.from('.txt')]) // ISO-8859-1 é
  fs.writeFileSync(Buffer.concat([Buffer.from(dir + '/'), bytes]), 'x\n')
  const res = parsePorcelainV1Z(rawBuf(dir))
  assert.equal(res.ok, true)
  const e = res.entries.find(x => x.pathEncoding === 'invalid-utf8')
  assert.ok(e, 'the invalid-UTF-8 path must be flagged')
  assert.equal(e.path, null, 'unknown is a value: there is no correct JS string for these bytes')
  assert.ok(Buffer.from(e.pathBytesBase64, 'base64').equals(bytes), 'the exact bytes survive')
  assert.equal(res.counts.nonUtf8Paths, 1)
  assert.ok(res.warnings.includes('non-utf8-paths-present'))
})

// ---------------------------------------------------------------------------------------------
// malformed input never throws

test('malformed inputs all return {ok:false, reason} and never throw', () => {
  const cases = [
    [null, 'input-must-be-buffer-or-string'],
    [42, 'input-must-be-buffer-or-string'],
    [{}, 'input-must-be-buffer-or-string'],
    [Buffer.from('M\0'), 'record-too-short'],
    [Buffer.from('MMx.txt\0'), 'malformed-record-separator'],
    [Buffer.from('ZQ f.txt\0'), 'unknown-status-code'],
    [Buffer.from('\0\0'), 'empty-record'],
    [Buffer.from('R  a.txt\0\0'), 'rename-empty-origin'],
    [' M a.txt\n M b.txt\n', 'input-not-nul-separated'],
  ]
  for (const [input, reason] of cases) {
    let res
    assert.doesNotThrow(() => { res = parsePorcelainV1Z(input) }, `threw on ${JSON.stringify(String(input))}`)
    assert.equal(res.ok, false, `expected failure for ${reason}`)
    assert.equal(res.reason, reason)
    assert.ok(res.limits, 'limits reported even on failure')
  }
})

test('empty input is a valid EMPTY result, not an error', () => {
  for (const input of [Buffer.alloc(0), '']) {
    const res = parsePorcelainV1Z(input)
    assert.equal(res.ok, true)
    assert.deepEqual(res.entries, [])
    assert.equal(res.counts.total, 0)
  }
})

test('an unterminated final record is still parsed', () => {
  const res = parsePorcelainV1Z(Buffer.from(' M a.txt\0 M b.txt'))
  assert.equal(res.ok, true)
  assert.equal(res.entries.length, 2)
})

// ---------------------------------------------------------------------------------------------
// caps are never silent

test('the entry cap is reported, and the limit comes back with the result', () => {
  const many = Array.from({ length: 20 }, (_, i) => `?? f${i}.txt`).join('\0') + '\0'
  const res = parsePorcelainV1Z(Buffer.from(many), { maxEntries: 5 })
  assert.equal(res.ok, true)
  assert.equal(res.entries.length, 5)
  assert.equal(res.truncated, true, 'a cap must never be silent')
  assert.equal(res.limits.maxEntries, 5)
})

test('under the cap, truncated is false and the default limit is still reported', () => {
  const res = parsePorcelainV1Z(Buffer.from('?? a.txt\0'))
  assert.equal(res.truncated, false)
  assert.equal(res.limits.maxEntries, STATUS_LIMITS.maxEntries)
})

// ---------------------------------------------------------------------------------------------
// branch header

test('branch header from real git: fresh repo reports noCommitsYet and NULL ahead/behind', () => {
  const dir = tmpRepo('freshbranch')
  write(dir, 'a.txt', 'x\n')
  const res = parsePorcelainV1Z(sh(dir, ['status', '--porcelain=v1', '-z', '--branch'], { encoding: 'buffer' }).stdout)
  assert.equal(res.ok, true)
  assert.equal(res.branch.branch, 'main')
  assert.equal(res.branch.noCommitsYet, true)
  assert.equal(res.branch.upstream, null)
  assert.equal(res.branch.ahead, null, 'no upstream => ahead is UNKNOWN, not 0')
  assert.equal(res.branch.behind, null)
})

test('branch header from real git after a commit', () => {
  const dir = tmpRepo('branchhdr')
  write(dir, 'a.txt', 'x\n'); commitAll(dir, 'one')
  const res = parsePorcelainV1Z(sh(dir, ['status', '--porcelain=v1', '-z', '--branch'], { encoding: 'buffer' }).stdout)
  assert.equal(res.branch.branch, 'main')
  assert.equal(res.branch.noCommitsYet, false)
  assert.equal(res.branch.detached, false)
})

test('detached HEAD from real git has a NULL branch name', () => {
  const dir = tmpRepo('detached')
  write(dir, 'a.txt', 'x\n'); commitAll(dir, 'one')
  const sha = sh(dir, ['rev-parse', 'HEAD']).stdout.trim()
  sh(dir, ['checkout', '-q', sha])
  const res = parsePorcelainV1Z(sh(dir, ['status', '--porcelain=v1', '-z', '--branch'], { encoding: 'buffer' }).stdout)
  assert.equal(res.branch.detached, true)
  assert.equal(res.branch.branch, null)
})

test('parseBranchHeader: upstream, ahead/behind, gone', () => {
  const t = parseBranchHeader('## main...origin/main [ahead 2, behind 3]')
  assert.deepEqual([t.branch, t.upstream, t.ahead, t.behind], ['main', 'origin/main', 2, 3])

  const zero = parseBranchHeader('## main...origin/main')
  assert.deepEqual([zero.ahead, zero.behind], [0, 0], 'upstream present => 0 is MEASURED')

  const none = parseBranchHeader('## solo')
  assert.deepEqual([none.upstream, none.ahead, none.behind], [null, null, null], 'no upstream => unknown')

  const gone = parseBranchHeader('## main...origin/main [gone]')
  assert.equal(gone.upstreamGone, true)
  assert.equal(gone.ahead, null, 'a gone upstream cannot be counted against')

  assert.equal(parseBranchHeader('not a header').ok, false)
  assert.equal(parseBranchHeader(null).ok, false)
  assert.equal(parseBranchHeader(undefined).ok, false)
})
