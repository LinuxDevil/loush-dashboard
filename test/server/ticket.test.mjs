// Tests for server/ticket.mjs pure logic + the plane boundary.
//
// The key-normalization cases are the primary failure path for this feature: the KEY is the only
// input the user gives, so every form a human might paste has to land on the right ticket or be
// refused outright. Guessing is worse than refusing — it silently opens someone else's ticket.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { normalizeKey } from '../../server/ticket.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

test('accepts the forms a human actually pastes', () => {
  for (const [input, want] of [
    ['ABC-1234', 'ABC-1234'],
    ['abc-1234', 'ABC-1234'],
    ['  ABC-1234  ', 'ABC-1234'],
    ['ABC 1234', 'ABC-1234'],
    ['ABC_1234', 'ABC-1234'],
    ['abc.1234', 'ABC-1234'],
    ['<ABC-1234>', 'ABC-1234'],
    ['(ABC-1234)', 'ABC-1234'],
    ['ABC-1234:', 'ABC-1234'],
    ['https://team.atlassian.net/browse/ABC-1234', 'ABC-1234'],
    ['https://team.atlassian.net/browse/ABC-1234?filter=10001', 'ABC-1234'],
    ['https://team.atlassian.net/jira/software/projects/ABC/boards/1?selectedIssue=ABC-77', 'ABC-77'],
    ['A1B2-9', 'A1B2-9'],
  ]) assert.equal(normalizeKey(input), want, `${input} -> ${want}`)
})

test('refuses rather than guesses', () => {
  // A bare number is the important one: with several projects configured there is no honest way to
  // pick a prefix, and picking the first one is how you silently open the wrong ticket.
  for (const bad of ['', '   ', '1234', 'ABC', 'ABC-', '-1234', 'nonsense', 'ABC-12x', null, undefined, '1ABC-2'])
    assert.equal(normalizeKey(bad), null, JSON.stringify(bad))
})

test('key normalization is idempotent', () => {
  const once = normalizeKey('abc 1234')
  assert.equal(normalizeKey(once), once)
})

// ── the plane boundary, as a static assertion ────────────────────────────────────────────────────
// server/eng.mjs is PLANE A (work artifacts). server/ticket.mjs is PLANE B: it spawns agents and
// holds sessionIds and cost. The dependency must run one way only. The existing privacy test walks
// the RETURN VALUES of seven exported functions, so it would not notice a new import — this closes
// that gap at the source level, where it is actually checkable.
test('server/eng.mjs does not import the plane-B agent or clone modules', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server/eng.mjs'), 'utf8')
  for (const banned of ['lib/agent.mjs', 'lib/clone.mjs', 'server/ticket.mjs', './ticket.mjs']) {
    assert.ok(!new RegExp(`^\\s*import[^\\n]*${banned.replace(/[./]/g, '\\$&')}`, 'm').test(src),
      `server/eng.mjs must not import ${banned} — that would put agent sessions and cost into plane A`)
  }
})

test('server/ticket.mjs never re-implements JIRA auth — it reuses the plane-A fetch path', () => {
  const src = fs.readFileSync(path.join(ROOT, 'server/ticket.mjs'), 'utf8')
  assert.ok(/from '\.\/eng\.mjs'/.test(src), 'ticket.mjs imports the shared ticket fetch from eng.mjs')
  assert.ok(!/Buffer\.from\([^)]*:\s*\$\{?token/.test(src), 'ticket.mjs must not build its own Basic auth header')
})

test('the design prompt demands cited findings — the property that separates a design from a guess', () => {
  const p = fs.readFileSync(path.join(ROOT, 'server/prompts/design-plan.md'), 'utf8')
  assert.ok(/file:line/.test(p), 'requires file:line citations')
  assert.ok(/at least one entry you could not verify/i.test(p), 'requires an unverified-risks entry')
  assert.ok(/Never invent a file path/i.test(p), 'forbids invented paths')
})

test('the ticket state directory is gitignored — it holds per-ticket design state, not shipped config', () => {
  const gi = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8')
  assert.ok(/^\.ticket-state\/$/m.test(gi))
})
