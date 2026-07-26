// Tests for server-setup.mjs pure logic — validation, secret merging, and the .gitignore check.
//
// The secret-merge rules matter more than they look: get them wrong and editing the email field
// silently wipes the stored API token, because the form has no token to resubmit — it was never
// given one, by design.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateProject, validateWork, validateSpTable, mergeSecrets, isIgnored } from '../server/setup.mjs'

// ---------------------------------------------------------------- validateProject

test('validateProject accepts a well-formed project', () => {
  assert.deepEqual(validateProject({
    key: 'ABC', name: 'Web', githubRepo: 'acme/web',
    devEmails: ['dev@example.com'], qaEmails: [], productEmails: [],
  }), [])
})

test('validateProject rejects a bad or missing key', () => {
  for (const key of ['', '1ABC', 'A B', 'A-B', undefined]) assert.ok(validateProject({ key }).length, `should reject ${key}`)
  assert.deepEqual(validateProject({ key: 'ABC' }), [])
})

test('validateProject accepts a lowercase key — the handler uppercases it on save', () => {
  assert.deepEqual(validateProject({ key: 'abc' }), [], 'typing "abc" should not be an error')
})

test('validateProject rejects a repo that is not owner/name', () => {
  assert.ok(validateProject({ key: 'ABC', githubRepo: 'justname' }).length)
  assert.ok(validateProject({ key: 'ABC', githubRepo: 'https://github.com/a/b' }).length)
  assert.deepEqual(validateProject({ key: 'ABC', githubRepo: 'a/b' }), [])
})

test('validateProject rejects a JIRA host with a scheme', () => {
  assert.ok(validateProject({ key: 'ABC', jiraHost: 'https://x.atlassian.net' }).length)
  assert.deepEqual(validateProject({ key: 'ABC', jiraHost: 'x.atlassian.net' }), [])
})

test('validateProject names the offending email address', () => {
  const e = validateProject({ key: 'ABC', devEmails: ['fine@example.com', 'not-an-email'] })
  assert.equal(e.length, 1)
  assert.match(e[0], /not-an-email/)
})

// ---------------------------------------------------------------- validateWork

const goodWork = { tzOffsetHours: 0, startHour: 9, endHour: 17, weekend: [0, 6], weekStartDay: 1 }

test('validateWork accepts a sane week', () => {
  assert.deepEqual(validateWork(goodWork), [])
  assert.deepEqual(validateWork({ ...goodWork, tzOffsetHours: 3, weekend: [5, 6], weekStartDay: 0 }), [])
})

test('validateWork rejects a zero-length or inverted day — it would make every duration infinite', () => {
  assert.ok(validateWork({ ...goodWork, startHour: 14, endHour: 14 }).length)
  assert.ok(validateWork({ ...goodWork, startHour: 18, endHour: 9 }).length)
})

test('validateWork rejects an all-weekend week', () => {
  assert.ok(validateWork({ ...goodWork, weekend: [0, 1, 2, 3, 4, 5, 6] }).length)
})

test('validateWork rejects out-of-range offsets and day numbers', () => {
  assert.ok(validateWork({ ...goodWork, tzOffsetHours: 26 }).length)
  assert.ok(validateWork({ ...goodWork, weekend: [7] }).length)
  assert.ok(validateWork({ ...goodWork, weekStartDay: 9 }).length)
})

test('validateWork rejects non-numeric input from a text field', () => {
  assert.ok(validateWork({ ...goodWork, startHour: '9' }).length, 'strings must not slip through')
  assert.ok(validateWork({ ...goodWork, tzOffsetHours: NaN }).length)
})

// ---------------------------------------------------------------- validateSpTable

test('validateSpTable requires ascending points and positive days', () => {
  assert.deepEqual(validateSpTable([[1, 0.4], [2, 0.8], [5, 3]]), [])
  assert.ok(validateSpTable([[2, 1], [1, 2]]).length, 'descending points')
  assert.ok(validateSpTable([[1, 0]]).length, 'zero days')
  assert.ok(validateSpTable([[0, 1]]).length, 'zero points')
  assert.ok(validateSpTable([]).length, 'empty table')
  assert.ok(validateSpTable([[1]]).length, 'malformed row')
})

// ---------------------------------------------------------------- mergeSecrets

test('mergeSecrets LEAVES a stored value when the field is absent', () => {
  // The UI never receives the token, so it cannot resubmit it. An email-only edit must not wipe it.
  const out = mergeSecrets({ jiraEmail: 'a@b.com', jiraToken: 'tok' }, { jiraEmail: 'c@d.com' })
  assert.equal(out.jiraToken, 'tok', 'editing the email must not destroy the token')
  assert.equal(out.jiraEmail, 'c@d.com')
})

test('mergeSecrets CLEARS on an explicit empty string', () => {
  const out = mergeSecrets({ jiraEmail: 'a@b.com', jiraToken: 'tok' }, { jiraToken: '' })
  assert.equal('jiraToken' in out, false)
  assert.equal(out.jiraEmail, 'a@b.com')
})

test('mergeSecrets treats undefined and null distinctly from a value', () => {
  const base = { jiraToken: 'tok' }
  assert.equal(mergeSecrets(base, { jiraToken: undefined }).jiraToken, 'tok', 'undefined leaves')
  assert.equal('jiraToken' in mergeSecrets(base, { jiraToken: null }), false, 'null clears')
})

test('mergeSecrets trims surrounding whitespace from a pasted token', () => {
  assert.equal(mergeSecrets({}, { jiraToken: '  abc123\n' }).jiraToken, 'abc123')
})

test('mergeSecrets does not mutate the stored object', () => {
  const existing = { jiraToken: 'tok' }
  mergeSecrets(existing, { jiraToken: '' })
  assert.equal(existing.jiraToken, 'tok')
})

// ---------------------------------------------------------------- isIgnored

test('isIgnored recognises the forms a credentials file is listed in', () => {
  const gi = '# comment\nnode_modules\n.eng.local.json\n/projects.json\ndist/\n'
  assert.equal(isIgnored(gi, '.eng.local.json'), true)
  assert.equal(isIgnored(gi, 'projects.json'), true, 'leading slash form')
  assert.equal(isIgnored(gi, 'dist'), true, 'trailing slash form')
})

test('isIgnored returns false when the file is committable — this is the warning that matters', () => {
  assert.equal(isIgnored('node_modules\n', '.eng.local.json'), false)
  assert.equal(isIgnored('', '.eng.local.json'), false)
  assert.equal(isIgnored('# .eng.local.json\n', '.eng.local.json'), false, 'a commented-out line does not ignore anything')
})
