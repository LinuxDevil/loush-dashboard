import { test } from 'node:test'
import assert from 'node:assert/strict'
import { toggleOffFile } from '../customize-toggle.mjs'

// in-memory fs: a Set of existing paths + a renameSync that mutates it
const mkIo = (...paths) => {
  const set = new Set(paths)
  return {
    set,
    existsSync: p => set.has(p),
    renameSync: (from, to) => { assert.ok(set.has(from)); set.delete(from); set.add(to) },
  }
}
const F = '/s/skills/foo/SKILL.md'

test('disable renames live → .off; enable renames back (reversible round-trip)', () => {
  const io = mkIo(F)
  assert.deepEqual(toggleOffFile(F, false, io), { ok: true, enabled: false })
  assert.ok(io.set.has(F + '.off') && !io.set.has(F))
  assert.deepEqual(toggleOffFile(F, true, io), { ok: true, enabled: true })
  assert.ok(io.set.has(F) && !io.set.has(F + '.off'))
})

test('idempotent: toggling to the state it is already in is a noop, never an error', () => {
  const io = mkIo(F) // already enabled
  const r = toggleOffFile(F, true, io)
  assert.equal(r.noop, true)
  assert.ok(io.set.has(F)) // untouched
})

test('refuses to clobber: both live and .off present → 409, no rename', () => {
  const io = mkIo(F, F + '.off')
  assert.throws(() => toggleOffFile(F, false, io), e => e.status === 409)
  assert.ok(io.set.has(F) && io.set.has(F + '.off')) // nothing moved
})
