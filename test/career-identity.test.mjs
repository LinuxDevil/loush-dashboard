import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolveIdentity, matchesMe, warnIfNoMatch } from '../career-identity.mjs'

test('matchesMe handles two git emails, case-insensitively', () => {
  const r = resolveIdentity({ gitEmails: ['Ali@work.com', 'ali@personal.dev'] })
  assert.equal(matchesMe(r, { email: 'ALI@WORK.COM' }), true)
  assert.equal(matchesMe(r, { email: 'ali@personal.dev' }), true)
  assert.equal(matchesMe(r, { email: 'someone@else.com' }), false)
})

test('empty identity never claims a match', () => {
  const r = resolveIdentity({ gitEmails: [] })
  assert.equal(r.isEmpty, true)
  assert.equal(matchesMe(r, { email: 'ali@work.com' }), false)
})

test('warnIfNoMatch warns only on zero matches with a non-empty identity', () => {
  const warned = []
  const log = m => warned.push(m)
  const r = resolveIdentity({ gitEmails: ['ali@work.com'] })
  warnIfNoMatch(r, 0, 'git', log)
  warnIfNoMatch(r, 5, 'git', log)
  warnIfNoMatch(resolveIdentity({ gitEmails: [] }), 0, 'git', log)
  assert.equal(warned.length, 1)
  assert.match(warned[0], /git/)
})
