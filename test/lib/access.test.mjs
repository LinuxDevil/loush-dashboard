import test from 'node:test'
import assert from 'node:assert/strict'
import { parseMode, formatMode, isValidMode, emptyStore, normalizeStore, modeFor, checkAccess, setPermission, removePermission, buildMatrix, DENY } from '../../lib/access.mjs'

const store = (permissions, enforced = true) => normalizeStore({ enforced, permissions })

test('modes round-trip through parse and format', () => {
  assert.deepEqual(parseMode('rwx'), { r: true, w: true, x: true })
  assert.deepEqual(parseMode('r--'), { r: true, w: false, x: false })
  assert.equal(formatMode(parseMode('rw-')), 'rw-')
  assert.equal(formatMode({}), '---')
})

test('a malformed mode is refused rather than coerced', () => {
  // Reading "rwz" as read-write would grant access the user never wrote down.
  for (const bad of ['rwz', 'rw', 'rwxx', 'xwr', '', null, 'RWX']) assert.equal(parseMode(bad), null, `${bad} should not parse`)
  assert.equal(isValidMode('r--'), true)
})

test('an unconfigured cell denies — access is granted, never assumed', () => {
  const s = store({ alice: { '/a': 'rwx' } })
  assert.equal(modeFor(s, 'alice', '/a'), 'rwx')
  assert.equal(modeFor(s, 'alice', '/unknown'), DENY)
  assert.equal(modeFor(s, 'nobody', '/a'), DENY)
  assert.equal(modeFor(emptyStore(), 'anyone', '/anything'), DENY)
})

test('nothing is inherited between cells', () => {
  // The property that makes the grid readable: a cell means only itself. Access to one project
  // implies nothing about a sibling, a parent path, or another profile.
  const s = store({ alice: { '/repos/a': 'rwx' } })
  assert.equal(checkAccess(s, { profile: 'alice', project: '/repos/a/sub', need: 'r' }).granted, false)
  assert.equal(checkAccess(s, { profile: 'alice', project: '/repos', need: 'r' }).granted, false)
  assert.equal(checkAccess(s, { profile: 'bob', project: '/repos/a', need: 'r' }).granted, false)
})

test('there is no wildcard row that quietly covers everything', () => {
  const s = store({ '*': { '*': 'rwx' } })
  assert.equal(checkAccess(s, { profile: 'alice', project: '/a', need: 'r' }).granted, false)
})

test('each bit gates its own action', () => {
  const s = store({ alice: { '/a': 'r--' } })
  assert.equal(checkAccess(s, { profile: 'alice', project: '/a', need: 'r' }).allowed, true)
  assert.equal(checkAccess(s, { profile: 'alice', project: '/a', need: 'w' }).allowed, false)
  assert.equal(checkAccess(s, { profile: 'alice', project: '/a', need: 'x' }).allowed, false)
})

test('while not enforcing, a denied action is allowed but still reported as denied', () => {
  // This is what makes the matrix safe to fill in on a live install.
  const s = store({ alice: { '/a': '---' } }, false)
  const d = checkAccess(s, { profile: 'alice', project: '/a', need: 'w' })
  assert.equal(d.allowed, true)
  assert.equal(d.granted, false)
  assert.equal(d.wouldDeny, true)
  assert.match(d.reason, /not enforced/)
})

test('enforcing turns the same decision into a refusal', () => {
  const d = checkAccess(store({ alice: { '/a': '---' } }, true), { profile: 'alice', project: '/a', need: 'w' })
  assert.equal(d.allowed, false)
  assert.equal(d.wouldDeny, true)
})

test('an unknown access mode is an error, not a silent allow', () => {
  assert.throws(() => checkAccess(emptyStore(), { profile: 'a', project: '/a', need: 'delete' }), /unknown access mode/)
})

test('a corrupt cell degrades to deny without disabling the rest of the policy', () => {
  const s = normalizeStore({ enforced: true, permissions: { alice: { '/a': 'rwx', '/b': 'nonsense' } } })
  assert.equal(modeFor(s, 'alice', '/a'), 'rwx')
  assert.equal(modeFor(s, 'alice', '/b'), DENY)
})

test('a store that is missing or junk becomes an empty, non-enforcing policy', () => {
  for (const junk of [null, undefined, 42, 'nope', []]) {
    const s = normalizeStore(junk)
    assert.equal(s.enforced, false)
    assert.deepEqual(s.permissions, {})
  }
})

test('enforcement must be set explicitly true — a truthy value is not enough', () => {
  assert.equal(normalizeStore({ enforced: 'yes', permissions: {} }).enforced, false)
  assert.equal(normalizeStore({ enforced: 1, permissions: {} }).enforced, false)
  assert.equal(normalizeStore({ enforced: true, permissions: {} }).enforced, true)
})

test('setting a permission does not mutate the store it was given', () => {
  const before = store({ alice: { '/a': 'r--' } })
  const after = setPermission(before, 'alice', '/a', 'rwx')
  assert.equal(modeFor(before, 'alice', '/a'), 'r--')
  assert.equal(modeFor(after, 'alice', '/a'), 'rwx')
})

test('setting an invalid mode is rejected', () => {
  assert.throws(() => setPermission(emptyStore(), 'a', '/a', 'yes'), /invalid mode/)
  assert.throws(() => setPermission(emptyStore(), '', '/a', 'rwx'), /required/)
})

test('an explicit deny is kept, so "denied on purpose" stays distinct from "never configured"', () => {
  const s = setPermission(emptyStore(), 'alice', '/a', '---')
  assert.equal(buildMatrix(s).rows[0].cells[0].configured, true)
  const cleared = removePermission(s, 'alice', '/a')
  assert.deepEqual(cleared.permissions, {})
})

test('the matrix is dense, so an unconfigured cell is visible rather than absent', () => {
  const m = buildMatrix(store({ alice: { '/a': 'rwx' } }), { profiles: ['bob'], projects: ['/b'] })
  assert.deepEqual(m.profiles, ['alice', 'bob'])
  assert.deepEqual(m.projects, ['/a', '/b'])
  const bobOnA = m.rows.find(r => r.profile === 'bob').cells.find(c => c.project === '/a')
  assert.equal(bobOnA.mode, DENY)
  assert.equal(bobOnA.configured, false)
})
