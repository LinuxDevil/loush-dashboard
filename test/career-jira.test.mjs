import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveIdentity } from '../career-identity.mjs'
import { importJira } from '../career-import-jira.mjs'

const DIR = path.dirname(fileURLToPath(import.meta.url))
const issues = JSON.parse(fs.readFileSync(path.join(DIR, 'fixtures/jira/issues.json'), 'utf8'))
const ME = '712020:44f60018-c4ed-45bf-ba4e-2633d697e6d4'
const resolved = resolveIdentity({ jiraAccountId: ME })

test('originated counts reporter==me; reopenedRate counts done→active; cycle time present', () => {
  const r = importJira({ issues, resolved })
  assert.ok(!r.error)
  // reporters==me: AIR-10474, TRN-229 → 2 originated; assignees==me: all 4
  assert.equal(r.originatedVsAssigned.originated, 2)
  assert.equal(r.originatedVsAssigned.assigned, 4)
  assert.equal(r.originatedVsAssigned.ratio, 2 / 4)
  // exactly one issue (TRN-260) has a Done -> In Progress transition
  assert.equal(r.reopenedRate, 1 / 4)
  // Story Points present on 2 issues → estimateVsActual has those
  assert.equal(r.estimateVsActual.length, 2)
  assert.ok(r.estimateVsActual.every(e => typeof e.actualHrs === 'number'))
  assert.ok(Object.keys(r.cycleTimeByPhaseHrs).length > 0)
})

test('never throws — {error} on garbage', () => {
  const r = importJira({ issues: 'not-an-array', resolved })
  assert.ok(r.error)
  assert.equal(r.originatedVsAssigned.originated, 0)
})
